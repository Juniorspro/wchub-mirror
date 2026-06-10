// ============================================================================
// game/messages.ts — Dressup Lounge input handlers
//
// Channels:
//   "input" — movement + aim + seq (standard rezona net layer)
//   "equip" — outfit change (textureItemIds, accessoryItemIds as CSV)
//   "chat"  — chat text (broadcast as a 'chat' event to all clients)
//   "rename"— change display name
//
// Every payload is hostile until validated. No module-level mutable state —
// per-room counters live in the closure of registerMessages.
// ============================================================================

import { Room } from "colyseus";
import { GameState } from "./state";
import { gameConfig } from "../game.config";
import { TICK_HZ, MAP_W, MAP_H, PLAYER_SPEED } from "../shared/constants";
import { movePlayer, normalizeInput, clamp } from "../shared/math";
import { registerBettingEvent } from "./event";
import { registerSoccerBall } from "./soccer";

const DT = 1 / TICK_HZ;

// Catalogues of legal item ids (kept in sync with client items.ts).
// Server only needs to know the IDs to validate; it doesn't render them.
const LEGAL_TEXTURE_ITEM_IDS = new Set<string>([
  "skin-light", "skin-tan", "skin-deep", "skin-mint",
  "shirt-white-tee", "shirt-yellow-polo", "shirt-red-sweater", "shirt-blue-hoodie", "shirt-black-jacket",
  "shirt-contrast-polo", "shirt-logo-tee",
  "jersey-argentina", "jersey-brazil", "jersey-germany", "jersey-france", "jersey-netherlands",
  "jersey-spain", "jersey-italy", "jersey-england", "jersey-portugal", "jersey-croatia",
  "pants-blue-jeans", "pants-black-slacks", "pants-gray-sweats", "pants-red-shorts", "pants-khaki-cargo", "pants-plaid",
  "shoes-white-sneakers", "shoes-black-boots", "shoes-red-trainers", "shoes-brown-loafers", "shoes-yellow-sandals",
]);

// Custom per-panel designs ride the textureItems CSV as
// `look:<slot>:<base64url payload>`. The server doesn't decode them — the
// client encodes + decodes — but it gatekeeps the syntax and a hard length
// cap so a malformed payload can't blow up the schema or hog memory.
// Cap raised 900 → 2560 (2026-06-10) for the Design Bench pixel-art
// layer: a 24×24 grid is 576 hex nibbles inside the design JSON, which
// pushes the b64url payload past the old 900-char limit. Worst-case id
// is ~1.6 KB — broadcast only on equip, so bandwidth cost is negligible.
const LOOK_ID_RE = /^look:(shirt|pants|shoes):[A-Za-z0-9_\-]{8,2560}$/;
const MAX_LOOK_LEN = 2600;

const LEGAL_ACCESSORY_ITEM_IDS = new Set<string>([
  "hat-cap", "hat-top-hat", "hat-beanie", "hat-wizard",
  "glasses-round", "glasses-shades",
  "scarf-red", "scarf-mustard",
  "backpack-standard",
  // Facial-expression tokens — not mesh accessories; the client's
  // applyOutfit reshapes the face when one is present. 'neutral' is
  // the absent-token default and never rides the wire.
  "face-happy", "face-surprised", "face-wink", "face-cool",
]);

const MAX_CHAT_LEN = 200;
const MAX_NAME_LEN = 16;
const CHAT_RATE_LIMIT_MS = 500; // anti-spam: one msg per 500ms per player
// Jump animation is ~0.8s long; allow next jump 100ms after landing so the
// player can repeatedly bounce but can't spam a jump every frame.
const JUMP_RATE_LIMIT_MS = 900;
// Compliments — anti-spam, sender side AND target side. Sender can send a
// new compliment every 3s; the same target can receive at most one
// compliment every 10s (so no one player can be coin-farmed by friends
// firing in a loop).
const COMPLIMENT_SENDER_RATE_MS = 3000;
const COMPLIMENT_TARGET_RATE_MS = 10000;
// Wave emote is purely visual — light rate limit per sender.
const WAVE_RATE_LIMIT_MS = 1500;

type InputMsg = { seq?: unknown; vx?: unknown; vy?: unknown; aim?: unknown };
type EquipMsg = { textureItems?: unknown; accessoryItems?: unknown };
type ChatMsg = { text?: unknown };
type RenameMsg = { name?: unknown };

export function registerMessages(room: Room<GameState>, state: GameState): void {
  // Per-room state (closure-scoped — never module-level let).
  const lastChatAt = new Map<string, number>();
  const lastJumpAt = new Map<string, number>();
  const lastComplimentSentAt = new Map<string, number>();
  const lastComplimentReceivedAt = new Map<string, number>();
  const lastWaveAt = new Map<string, number>();

  // Soccer ball — see ./soccer.ts. Sets up the tick + 'ball:request' handler.
  const soccerBall = registerSoccerBall(room, state);

  room.onMessage<InputMsg>("input", (client, msg) => {
    const p = state.players.get(client.sessionId);
    if (!p) return;
    const { x: vx, y: vy } = normalizeInput(toNum(msg?.vx), toNum(msg?.vy));
    const next = movePlayer({ x: p.x, y: p.y }, { x: vx, y: vy }, DT, PLAYER_SPEED, MAP_W, MAP_H);
    // BANDWIDTH: only write the schema field when the value actually
    // changed. Colyseus's dirty-tracking flags any assignment (even a
    // self-assign), so guarding here turns stationary players into
    // zero-byte patches instead of constantly re-broadcasting the
    // same coordinates.
    if (next.x !== p.x) p.x = next.x;
    if (next.y !== p.y) p.y = next.y;
    const aim = toNum(msg?.aim);
    if (Number.isFinite(aim) && aim !== p.aim) p.aim = aim;
    // Soccer ball — if the player walked onto the ball this tick, apply
    // a kick impulse based on their input direction. No-op when player
    // isn't on the pitch / isn't moving / isn't near the ball.
    soccerBall.maybeKickBall(
      client.sessionId,
      p.username,
      next.x,
      next.y,
      vx,
      vy,
    );
    // Targeted ack — only the sender's reconciliation cares about its
    // own input-seq. Replaces the old `p.ack` schema field that fan'd
    // out to every peer on every tick (~7× wasted bytes per tick in a
    // full room).
    const seq = toNum(msg?.seq);
    if (Number.isFinite(seq) && seq > 0) client.send("ack", seq);
  });

  room.onMessage<EquipMsg>("equip", (client, msg) => {
    const p = state.players.get(client.sessionId);
    if (!p) return;
    const texture = sanitizeTextureCsv(msg?.textureItems, 8);
    const accessory = sanitizeCsvList(msg?.accessoryItems, LEGAL_ACCESSORY_ITEM_IDS, 6);
    // BANDWIDTH: build the diff before mutating. Only changed fields
    // ride the roster-update — saves bytes when the player only flipped
    // a hat (accessoryItems changed; textureItems didn't) etc.
    const fields: { textureItems?: string; accessoryItems?: string } = {};
    if (texture !== p.textureItems) {
      p.textureItems = texture;
      fields.textureItems = texture;
    }
    if (accessory !== p.accessoryItems) {
      p.accessoryItems = accessory;
      fields.accessoryItems = accessory;
    }
    if (fields.textureItems != null || fields.accessoryItems != null) {
      room.broadcast("roster-update", { sid: client.sessionId, fields });
    }
  });

  room.onMessage<ChatMsg>("chat", (client, msg) => {
    const p = state.players.get(client.sessionId);
    if (!p) return;
    const now = Date.now();
    const last = lastChatAt.get(client.sessionId) ?? 0;
    if (now - last < CHAT_RATE_LIMIT_MS) return;
    lastChatAt.set(client.sessionId, now);
    const text = sanitizeText(msg?.text, MAX_CHAT_LEN);
    if (!text) return;
    room.broadcast("chat", {
      from: client.sessionId,
      name: p.username,
      text,
      t: now,
    });
  });

  room.onMessage<RenameMsg>("rename", (client, msg) => {
    const p = state.players.get(client.sessionId);
    if (!p) return;
    const name = sanitizeText(msg?.name, MAX_NAME_LEN);
    if (!name || name === p.username) return;
    p.username = name;
    room.broadcast("roster-update", {
      sid: client.sessionId,
      fields: { username: name },
    });
  });

  // Roster snapshot — newly-joined clients send `roster-request` once
  // their NetClient is ready (no payload → full snapshot). When a new
  // sid later appears in the schema's players map, the client follows
  // up with `roster-request` carrying that one sid → one-record reply.
  // After that initial fill, individual updates ride `roster-update`
  // broadcasts on equip/rename.
  room.onMessage(
    "roster-request",
    (client, msg: { sid?: unknown } | undefined) => {
      const oneSid = typeof msg?.sid === "string" ? msg.sid : null;
      const players: Array<{
        sid: string;
        username: string;
        color: string;
        textureItems: string;
        accessoryItems: string;
      }> = [];
      if (oneSid) {
        const p = state.players.get(oneSid);
        if (p) {
          players.push({
            sid: oneSid,
            username: p.username,
            color: p.color,
            textureItems: p.textureItems,
            accessoryItems: p.accessoryItems,
          });
        }
      } else {
        state.players.forEach((p, sid) => {
          players.push({
            sid,
            username: p.username,
            color: p.color,
            textureItems: p.textureItems,
            accessoryItems: p.accessoryItems,
          });
        });
      }
      client.send("roster-snapshot", { players });
    },
  );

  // Jump — event-based (no state mutation). Server validates rate-limit
  // then broadcasts a `jump` event with the sender's sessionId so every
  // client (including the sender) plays the same visual hop on the same
  // avatar at the same time.
  room.onMessage("jump", (client) => {
    const p = state.players.get(client.sessionId);
    if (!p) return;
    const now = Date.now();
    const last = lastJumpAt.get(client.sessionId) ?? 0;
    if (now - last < JUMP_RATE_LIMIT_MS) return;
    lastJumpAt.set(client.sessionId, now);
    room.broadcast("jump", { from: client.sessionId });
  });

  // Compliment — peer-to-peer affirmation. Sender targets another
  // player's sessionId; server enforces rate limits on BOTH sides so
  // neither party can be spam-coin-farmed; broadcasts `{from, to}` to
  // every client. The target's client awards itself the coin reward
  // when it sees the broadcast (the server doesn't write into per-player
  // economy state — that's localStorage-backed on the client).
  room.onMessage("compliment", (client, msg: { to?: unknown } | undefined) => {
    const fromId = client.sessionId;
    const fromP = state.players.get(fromId);
    if (!fromP) return;
    const toId = typeof msg?.to === "string" ? msg.to : "";
    if (!toId || toId === fromId) return;
    const toP = state.players.get(toId);
    if (!toP) return;
    const now = Date.now();
    if (now - (lastComplimentSentAt.get(fromId) ?? 0) < COMPLIMENT_SENDER_RATE_MS) return;
    if (now - (lastComplimentReceivedAt.get(toId) ?? 0) < COMPLIMENT_TARGET_RATE_MS) return;
    lastComplimentSentAt.set(fromId, now);
    lastComplimentReceivedAt.set(toId, now);
    room.broadcast("compliment", { from: fromId, to: toId });
  });

  // Wave emote — purely cosmetic non-verbal greeting. No coins, no
  // target — just a "hi" broadcast that all clients render on the
  // sender's avatar.
  room.onMessage("wave", (client) => {
    const fromId = client.sessionId;
    const p = state.players.get(fromId);
    if (!p) return;
    const now = Date.now();
    if (now - (lastWaveAt.get(fromId) ?? 0) < WAVE_RATE_LIMIT_MS) return;
    lastWaveAt.set(fromId, now);
    room.broadcast("wave", { from: fromId });
  });

  // ─── Betting event: World Cup match-winner bets ────────────────────────
  // See event.ts. Registers its own onMessage handlers + a poll timer.
  registerBettingEvent(room, state);
}

// ─── Validators ─────────────────────────────────────────────────────────────

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sanitizeText(v: unknown, maxLen: number): string {
  if (typeof v !== "string") return "";
  // Strip control chars, collapse whitespace, trim, cap length.
  const cleaned = v.replace(/[ -]/g, "").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, maxLen);
}

function sanitizeCsvList(v: unknown, legal: Set<string>, maxItems: number): string {
  if (typeof v !== "string") return "";
  const parts = v.split(",").map((s) => s.trim()).filter((s) => s.length > 0 && legal.has(s));
  // De-dup
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of parts) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= maxItems) break;
  }
  return out.join(",");
}

// Same shape as sanitizeCsvList but with the extra `look:<slot>:<payload>`
// rule for custom per-panel garment designs. Catalog ids and look ids can
// freely mix in the same CSV — the client treats them identically once they
// reach getTextureItemOrCustom.
function sanitizeTextureCsv(v: unknown, maxItems: number): string {
  if (typeof v !== "string") return "";
  const parts = v.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of parts) {
    if (id.length > MAX_LOOK_LEN) continue;
    const ok = LEGAL_TEXTURE_ITEM_IDS.has(id) || LOOK_ID_RE.test(id);
    if (!ok) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= maxItems) break;
  }
  return out.join(",");
}

// Re-export clamp so existing imports keep working (Phase 1 baseline used it).
export { clamp };
