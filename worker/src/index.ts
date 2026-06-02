import { Container, getContainer } from "@cloudflare/containers";
import { DurableObject } from "cloudflare:workers";
// Single source of truth, shared with the Colyseus server. esbuild inlines this
// at build time (no runtime cross-package dependency). game.config.ts is plain
// data with no @colyseus/schema import, so it typechecks under the worker's
// decorator-free tsconfig. See game.config.ts header for the constraint.
import { gameConfig, serializeClientConfig } from "../../server/src/game.config";

export interface Env {
  GAME_SERVER: DurableObjectNamespace<GameServer>;
  MATCHMAKER: DurableObjectNamespace<Matchmaker>;
  ASSETS: Fetcher;
}

type RoomRecord = {
  code: string;
  players: number;
  maxPlayers: number;
  reservations: number[];
  updatedAt: number;
};

type ContainerStats = {
  code?: string;
  players?: number;
  rooms?: number;
  maxPlayers?: number;
};

const ROOM_MAX_PLAYERS = gameConfig.maxPlayers;
const ROOM_INDEX_KEY = "rooms";
const RESERVATION_TTL_MS = 20_000;
const CODE_ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_PREFIX = /^\/rooms\/([^/]+)(\/.*)?$/;
const CORS_ALLOW_METHODS = "GET,POST,OPTIONS";
const CORS_ALLOW_HEADERS = "content-type,authorization";
const CORS_MAX_AGE = "86400";

export class GameServer extends Container<Env> {
  defaultPort = gameConfig.port;
  sleepAfter = gameConfig.sleepAfter;
  enableInternet = false;
}

export class Matchmaker extends DurableObject<Env> {
  private queue: Promise<unknown> = Promise.resolve();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === "/matchmake" && request.method === "POST") {
      try {
        return await this.enqueue(() => this.allocateRoom(request));
      } catch (error) {
        return json({ error: errorMessage(error) }, 500, request);
      }
    }

    if (url.pathname === "/matchmake/stats" && request.method === "GET") {
      const rooms = await this.readRooms();
      return json({ rooms: Object.values(rooms) }, 200, request);
    }

    return json({ error: "not found" }, 404, request);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async allocateRoom(request: Request): Promise<Response> {
    const now = Date.now();
    const rooms = await this.readRooms();
    let best: RoomRecord | null = null;

    for (const record of Object.values(rooms)) {
      await this.refreshRoom(record, now);
      const activePlayers = record.players + record.reservations.length;

      if (activePlayers >= record.maxPlayers) continue;
      if (!best || activePlayers > best.players + best.reservations.length) {
        best = record;
      }
    }

    let created = false;
    if (!best) {
      const code = this.mintUniqueCode(rooms);
      best = {
        code,
        players: 0,
        maxPlayers: ROOM_MAX_PLAYERS,
        reservations: [],
        updatedAt: now,
      };
      rooms[code] = best;
      created = true;
    }

    best.reservations.push(now + RESERVATION_TTL_MS);
    best.updatedAt = now;
    await this.ctx.storage.put(ROOM_INDEX_KEY, rooms);

    return json({
      code: best.code,
      path: `/rooms/${encodeURIComponent(best.code)}`,
      players: best.players + best.reservations.length,
      actualPlayers: best.players,
      maxPlayers: best.maxPlayers,
      created,
    }, 200, request);
  }

  private async refreshRoom(record: RoomRecord, now: number) {
    record.reservations = record.reservations.filter((expiresAt) => expiresAt > now);

    const stats = await fetchContainerStats(this.env, record.code);
    if (!stats) return;

    const nextPlayers = clampInt(stats.players, 0, ROOM_MAX_PLAYERS);
    const joinedSinceLastRefresh = Math.max(0, nextPlayers - record.players);
    if (joinedSinceLastRefresh > 0) {
      record.reservations.splice(0, joinedSinceLastRefresh);
    }

    record.players = nextPlayers;
    record.maxPlayers = clampInt(stats.maxPlayers, 1, ROOM_MAX_PLAYERS) || ROOM_MAX_PLAYERS;
    record.updatedAt = now;
  }

  private async readRooms(): Promise<Record<string, RoomRecord>> {
    return (await this.ctx.storage.get<Record<string, RoomRecord>>(ROOM_INDEX_KEY)) ?? {};
  }

  private mintUniqueCode(rooms: Record<string, RoomRecord>) {
    for (let attempts = 0; attempts < 20; attempts++) {
      let code = "";
      for (let i = 0; i < 6; i++) {
        code += CODE_ALPHA[Math.floor(Math.random() * CODE_ALPHA.length)];
      }
      if (!rooms[code]) return code;
    }
    throw new Error("could not mint room code");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === "/health") {
      return new Response("worker ok", { status: 200 });
    }

    // Serve the client config as a tiny JS file (window.GAME_CONFIG).
    // MUST stay above the `env.ASSETS.fetch` fallthrough at the end — otherwise
    // this path falls to the static-assets binding, which has no such file and
    // returns 404, leaving the client with no config.
    if (url.pathname === "/game.config.js") {
      return new Response(serializeClientConfig(), {
        status: 200,
        headers: {
          "content-type": "application/javascript",
          "cache-control": "no-store",
        },
      });
    }

    if (url.pathname === "/matchmake" || url.pathname === "/matchmake/stats") {
      const id = env.MATCHMAKER.idFromName("global");
      return env.MATCHMAKER.get(id).fetch(request);
    }

    const m = ROOM_PREFIX.exec(url.pathname);
    if (m) {
      const roomCode = normalizeCode(decodeURIComponent(m[1]));
      if (!roomCode) {
        return json({ error: "invalid room code" }, 400, request);
      }

      const rest = m[2] ?? "/";
      const innerUrl = new URL(rest + url.search, url.origin);
      const headers = new Headers(request.headers);
      headers.set("x-room-code", roomCode);
      const forwarded = new Request(new Request(innerUrl.toString(), request), { headers });
      const container = getContainer(env.GAME_SERVER, roomCode);
      const response = await container.fetch(forwarded);
      return isWebSocketRequest(request) ? response : withCors(response, request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function fetchContainerStats(env: Env, code: string): Promise<ContainerStats | null> {
  try {
    const container = getContainer(env.GAME_SERVER, code);
    const res = await container.fetch(new Request("http://container/stats"));
    if (!res.ok) return null;
    return (await res.json()) as ContainerStats;
  } catch {
    return null;
  }
}

function normalizeCode(value: string): string | null {
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return code.length >= 4 ? code : null;
}

function clampInt(value: unknown, min: number, max: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function json(data: unknown, status = 200, request?: Request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request),
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function corsHeaders(request?: Request) {
  const origin = request?.headers.get("origin");
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": CORS_ALLOW_METHODS,
    "access-control-allow-headers": CORS_ALLOW_HEADERS,
    "access-control-max-age": CORS_MAX_AGE,
    "vary": "Origin",
  };
}

function withCors(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isWebSocketRequest(request: Request) {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}
