// ============================================================================
// game/fixtures.ts — Football-match fixture provider for the betting event.
//
// Pulls match fixtures (next ~12h) + live scores from Football-Data.org's
// free tier when FOOTBALL_API_KEY is set. Falls back to a STUB schedule
// otherwise so the betting loop is always demoable, even without
// credentials.
//
// All polling is server-side. Clients never touch the football API
// directly — they can lie about scores, and the API has a strict rate
// budget. The server polls, caches, and pushes deltas via the room's
// existing message channel (see event.ts).
//
// Phase 1 MVP scope:
//   - One competition at a time (default: 2026 FIFA World Cup, code WC)
//   - Three-way match-winner outcomes (HOME / DRAW / AWAY)
//   - The NEXT scheduled match is the "active" one; rolls over on FT
// ============================================================================

import * as https from "node:https";

// ─── Public types ──────────────────────────────────────────────────────────

export type MatchStatus =
  | "SCHEDULED"
  | "TIMED"
  | "IN_PLAY"
  | "PAUSED"
  | "FINISHED"
  | "POSTPONED"
  | "SUSPENDED"
  | "CANCELLED";

export interface Fixture {
  readonly id: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  /** Three-letter team code for jersey-supporter matching (e.g. "ARG"). */
  readonly homeCode: string;
  readonly awayCode: string;
  /** Kick-off time as epoch ms. */
  readonly kickoffMs: number;
  status: MatchStatus;
  /** Goals scored by home team; undefined until the match goes live. */
  scoreHome: number;
  scoreAway: number;
  /** Minute of play (server-side estimate; not authoritative). */
  minute: number;
  /** Final result, only set when status flips to FINISHED. */
  result: "HOME" | "DRAW" | "AWAY" | null;
}

// ─── Stub fixtures ─────────────────────────────────────────────────────────

/** Build a stub schedule relative to NOW so the UI is always demonstrable.
 *  The first match starts in 8 minutes (so the bet window is OPEN now),
 *  the next two are spaced an hour apart. */
function buildStubFixtures(): Fixture[] {
  const now = Date.now();
  return [
    {
      id: "stub-arg-bra",
      homeTeam: "Argentina", homeCode: "ARG",
      awayTeam: "Brazil",    awayCode: "BRA",
      kickoffMs: now + 8 * 60 * 1000,
      status: "SCHEDULED",
      scoreHome: 0, scoreAway: 0, minute: 0, result: null,
    },
    {
      id: "stub-ger-fra",
      homeTeam: "Germany",  homeCode: "GER",
      awayTeam: "France",   awayCode: "FRA",
      kickoffMs: now + 70 * 60 * 1000,
      status: "SCHEDULED",
      scoreHome: 0, scoreAway: 0, minute: 0, result: null,
    },
    {
      id: "stub-eng-esp",
      homeTeam: "England",  homeCode: "ENG",
      awayTeam: "Spain",    awayCode: "ESP",
      kickoffMs: now + 130 * 60 * 1000,
      status: "SCHEDULED",
      scoreHome: 0, scoreAway: 0, minute: 0, result: null,
    },
  ];
}

// ─── Football-Data.org client ──────────────────────────────────────────────

const COMPETITION_CODE = process.env.FOOTBALL_COMPETITION || "WC";
const API_HOST = "api.football-data.org";

interface FdMatchTeam { name?: string; tla?: string; }
interface FdScore { home: number | null; away: number | null; }
interface FdMatch {
  id?: number;
  homeTeam?: FdMatchTeam;
  awayTeam?: FdMatchTeam;
  utcDate?: string;
  status?: string;
  minute?: number | null;
  score?: { fullTime?: FdScore; halfTime?: FdScore };
}

function httpJson<T>(path: string, headers: Record<string, string>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: API_HOST, path, method: "GET", headers,
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`football-data ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(body) as T); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(8000, () => req.destroy(new Error("football-data timeout")));
    req.end();
  });
}

function parseFdMatch(m: FdMatch): Fixture | null {
  if (m.id == null || !m.utcDate || !m.homeTeam?.name || !m.awayTeam?.name) return null;
  const kickoffMs = Date.parse(m.utcDate);
  if (!Number.isFinite(kickoffMs)) return null;
  const statusRaw = (m.status ?? "SCHEDULED").toUpperCase();
  const status: MatchStatus =
    statusRaw === "TIMED" || statusRaw === "SCHEDULED" ? "SCHEDULED" :
    statusRaw === "IN_PLAY" || statusRaw === "LIVE" ? "IN_PLAY" :
    statusRaw === "PAUSED" ? "PAUSED" :
    statusRaw === "FINISHED" ? "FINISHED" :
    statusRaw === "POSTPONED" ? "POSTPONED" :
    statusRaw === "SUSPENDED" ? "SUSPENDED" :
    statusRaw === "CANCELLED" ? "CANCELLED" : "SCHEDULED";
  const ft = m.score?.fullTime;
  const scoreHome = (ft?.home ?? 0) || 0;
  const scoreAway = (ft?.away ?? 0) || 0;
  let result: Fixture["result"] = null;
  if (status === "FINISHED") {
    result = scoreHome > scoreAway ? "HOME" : scoreHome < scoreAway ? "AWAY" : "DRAW";
  }
  return {
    id: String(m.id),
    homeTeam: m.homeTeam.name,
    awayTeam: m.awayTeam.name,
    homeCode: (m.homeTeam.tla ?? "").slice(0, 3).toUpperCase() || m.homeTeam.name.slice(0, 3).toUpperCase(),
    awayCode: (m.awayTeam.tla ?? "").slice(0, 3).toUpperCase() || m.awayTeam.name.slice(0, 3).toUpperCase(),
    kickoffMs,
    status,
    scoreHome, scoreAway,
    minute: m.minute ?? 0,
    result,
  };
}

// ─── Poller ────────────────────────────────────────────────────────────────

export interface FixturePollerOpts {
  /** Optional override; defaults to env FOOTBALL_API_KEY. */
  apiKey?: string;
  /** Force stub mode (ignore key). */
  useStub?: boolean;
}

export class FixturePoller {
  private apiKey: string;
  private useStub: boolean;
  private cache: Fixture[] = [];
  private lastFetchedAt = 0;
  /** When set, error-back-off until this epoch ms. */
  private backoffUntil = 0;

  constructor(opts: FixturePollerOpts = {}) {
    this.apiKey = opts.apiKey ?? process.env.FOOTBALL_API_KEY ?? "";
    this.useStub = opts.useStub ?? !this.apiKey;
    if (this.useStub) {
      // Seed the cache with stub fixtures so consumers can read immediately.
      this.cache = buildStubFixtures();
    }
  }

  /** Return the current cached fixtures, sorted by kickoff time ascending. */
  getFixtures(): readonly Fixture[] {
    return this.cache;
  }

  /** Refresh cache. Cheap when called more frequently than ~20s — internal
   *  rate-limit guard prevents hammering. */
  async poll(): Promise<void> {
    const now = Date.now();
    if (this.backoffUntil > now) return;
    if (now - this.lastFetchedAt < 20_000) return;
    this.lastFetchedAt = now;

    if (this.useStub) {
      // Drive stub fixtures forward in time so the bet→live→resolve
      // lifecycle progresses naturally for demos.
      this.advanceStub();
      return;
    }

    try {
      const data = await httpJson<{ matches: FdMatch[] }>(
        `/v4/competitions/${COMPETITION_CODE}/matches?status=SCHEDULED,TIMED,IN_PLAY,PAUSED,FINISHED`,
        { "X-Auth-Token": this.apiKey, "User-Agent": "dressup-fair/1.0" },
      );
      const fresh: Fixture[] = [];
      for (const m of data.matches ?? []) {
        const f = parseFdMatch(m);
        if (f) fresh.push(f);
      }
      fresh.sort((a, b) => a.kickoffMs - b.kickoffMs);
      this.cache = fresh;
    } catch (err) {
      // Back off 90s on error so we don't hammer a broken endpoint.
      this.backoffUntil = now + 90_000;
      console.warn("[fixtures] poll failed; backing off:", (err as Error).message);
    }
  }

  /** Advance the stub schedule: scheduled→in_play at kickoff, in_play→finished
   *  90 minutes later, with deterministic-ish scores. The stub seeds a fresh
   *  match into the future once the trailing one finishes. */
  private advanceStub(): void {
    const now = Date.now();
    let needsReseed = false;
    for (const f of this.cache) {
      if (f.status === "SCHEDULED" && now >= f.kickoffMs) {
        f.status = "IN_PLAY";
        f.minute = 1;
      }
      if (f.status === "IN_PLAY") {
        const elapsedMin = Math.floor((now - f.kickoffMs) / 60_000);
        f.minute = Math.min(90, Math.max(1, elapsedMin));
        // Goals trickle in pseudo-randomly: one team scores at minute
        // 23, the other at 67 — deterministic by match id for fairness.
        const hash = (() => {
          let h = 0;
          for (let i = 0; i < f.id.length; i++) h = (h * 31 + f.id.charCodeAt(i)) | 0;
          return Math.abs(h);
        })();
        f.scoreHome = (elapsedMin >= 23 ? 1 : 0) + ((hash & 1) && elapsedMin >= 78 ? 1 : 0);
        f.scoreAway = (elapsedMin >= 67 ? 1 : 0) + ((hash & 2) && elapsedMin >= 85 ? 1 : 0);
        if (elapsedMin >= 92) {
          f.status = "FINISHED";
          f.minute = 90;
          f.result = f.scoreHome > f.scoreAway ? "HOME"
                  : f.scoreHome < f.scoreAway ? "AWAY" : "DRAW";
          needsReseed = true;
        }
      }
    }
    if (needsReseed) {
      // Add a fresh future match so the schedule never runs dry.
      const teams: Array<[string, string, string, string]> = [
        ["Netherlands", "NED", "Croatia",    "CRO"],
        ["Portugal",    "POR", "Italy",      "ITA"],
        ["Argentina",   "ARG", "Germany",    "GER"],
        ["France",      "FRA", "Brazil",     "BRA"],
        ["Spain",       "ESP", "England",    "ENG"],
      ];
      const pick = teams[Math.floor(this.cache.length) % teams.length];
      const lastKickoff = this.cache.reduce((m, f) => Math.max(m, f.kickoffMs), now);
      this.cache.push({
        id: `stub-${pick[0]}-${pick[2]}-${this.cache.length}`,
        homeTeam: pick[0], homeCode: pick[1],
        awayTeam: pick[2], awayCode: pick[3],
        kickoffMs: lastKickoff + 60 * 60 * 1000,  // 1h after the last one
        status: "SCHEDULED",
        scoreHome: 0, scoreAway: 0, minute: 0, result: null,
      });
      // Trim finished matches older than 10 min so the cache doesn't grow forever.
      this.cache = this.cache.filter((f) => f.status !== "FINISHED" || now - f.kickoffMs < 100 * 60 * 1000);
    }
    this.cache.sort((a, b) => a.kickoffMs - b.kickoffMs);
  }
}
