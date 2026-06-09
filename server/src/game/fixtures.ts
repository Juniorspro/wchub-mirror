// ============================================================================
// game/fixtures.ts — World Cup fixture + standings provider for the
// betting event. Data source: openfootball/world-cup.json on GitHub
// (https://github.com/openfootball/world-cup.json), no API key needed.
//
// What OpenFootball gives us:
//   - The full match schedule (group stage + knockouts) with kickoff
//     dates/times and group assignments
//   - Final scores once matches conclude (community-maintained, lags
//     real-time by hours-to-days — fine for a daily refresh)
//
// What it does NOT give us:
//   - Live in-play scores or minute markers. Match status is derived
//     from current time vs kickoff: SCHEDULED if future, IN_PLAY for
//     the 2h after kickoff (best-effort guess), FINISHED once the
//     score appears in the JSON.
//
// Polling cadence: 30 minutes — the JSON is human-edited via GitHub
// PRs after matches conclude, so faster polling buys nothing. Daily
// is even fine; 30 min keeps the score-arrived gap small.
// ============================================================================

import * as https from "node:https";

// ─── Public types — standings ──────────────────────────────────────────────

export interface TeamStanding {
  position: number;
  team: string;
  code: string;          // 3-letter team code (TLA)
  played: number;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface GroupStanding {
  /** "A" / "B" / ... — the trailing letter of the API's "GROUP_X". */
  group: string;
  teams: TeamStanding[];
}

// ─── Public types — fixtures ───────────────────────────────────────────────

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

// ─── OpenFootball data source ──────────────────────────────────────────────

const OF_HOST = "raw.githubusercontent.com";
const OF_PATH = process.env.OPENFOOTBALL_PATH
  || "/openfootball/world-cup.json/master/2026/worldcup.json";

interface OfScore {
  ft?: [number, number];
  ht?: [number, number];
  et?: [number, number];
  p?: [number, number];
}
interface OfMatch {
  round?: string;
  date?: string;
  time?: string;
  team1?: string | { name?: string; code?: string };
  team2?: string | { name?: string; code?: string };
  group?: string;
  ground?: string;
  score?: OfScore;
}
interface OfRoot {
  name?: string;
  matches?: OfMatch[];
}

/** FIFA 3-letter team code lookup. OpenFootball uses full team names
 *  (e.g. "Mexico", "Republic of Ireland") — we want the 3-letter TLA
 *  that the UI displays. Fallback: first 3 letters of the name. */
const TEAM_CODES: Record<string, string> = {
  // Hosts + CONCACAF
  "Mexico": "MEX", "United States": "USA", "USA": "USA", "Canada": "CAN",
  "Costa Rica": "CRC", "Panama": "PAN", "Honduras": "HON",
  "Jamaica": "JAM", "Trinidad and Tobago": "TRI",
  // CONMEBOL
  "Argentina": "ARG", "Brazil": "BRA", "Uruguay": "URU", "Colombia": "COL",
  "Ecuador": "ECU", "Paraguay": "PAR", "Chile": "CHI", "Bolivia": "BOL",
  "Venezuela": "VEN", "Peru": "PER",
  // UEFA
  "England": "ENG", "France": "FRA", "Germany": "GER", "Spain": "ESP",
  "Portugal": "POR", "Italy": "ITA", "Netherlands": "NED", "Belgium": "BEL",
  "Croatia": "CRO", "Switzerland": "SUI", "Denmark": "DEN", "Sweden": "SWE",
  "Norway": "NOR", "Poland": "POL", "Austria": "AUT", "Wales": "WAL",
  "Scotland": "SCO", "Northern Ireland": "NIR", "Ireland": "IRL",
  "Republic of Ireland": "IRL", "Hungary": "HUN", "Turkey": "TUR",
  "Türkiye": "TUR", "Serbia": "SRB", "Ukraine": "UKR", "Czech Republic": "CZE",
  "Czechia": "CZE", "Slovenia": "SVN", "Slovakia": "SVK", "Greece": "GRE",
  "Albania": "ALB", "Romania": "ROU", "Russia": "RUS",
  "Bosnia and Herzegovina": "BIH", "North Macedonia": "MKD",
  // AFC
  "Iran": "IRN", "IR Iran": "IRN", "Iraq": "IRQ", "Saudi Arabia": "KSA",
  "Qatar": "QAT", "Japan": "JPN", "South Korea": "KOR", "Korea Republic": "KOR",
  "Australia": "AUS", "Uzbekistan": "UZB", "Jordan": "JOR",
  "United Arab Emirates": "UAE", "UAE": "UAE", "Bahrain": "BHR",
  "Oman": "OMA", "Lebanon": "LBN", "Syria": "SYR",
  // CAF
  "Senegal": "SEN", "Egypt": "EGY", "Morocco": "MAR", "Algeria": "ALG",
  "Tunisia": "TUN", "Nigeria": "NGA", "Cameroon": "CMR", "Ghana": "GHA",
  "Cote d'Ivoire": "CIV", "Côte d'Ivoire": "CIV", "Ivory Coast": "CIV",
  "South Africa": "RSA", "Mali": "MLI", "Cape Verde": "CPV",
  "Burkina Faso": "BFA", "DR Congo": "COD", "Congo DR": "COD",
  // OFC
  "New Zealand": "NZL", "Fiji": "FIJ",
};

function teamCode(name: string): string {
  if (!name) return "???";
  if (TEAM_CODES[name]) return TEAM_CODES[name];
  // Fallback: strip non-alpha + uppercase first 3.
  return name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "???";
}

function readTeam(t: OfMatch["team1"]): string {
  if (!t) return "";
  if (typeof t === "string") return t;
  return t.name ?? "";
}

/** Parse OpenFootball date+time into epoch ms. Time format examples:
 *  "13:00 UTC-6", "21:00 UTC", "12:00 UTC+3". Falls back to noon UTC
 *  when only a date is present. */
function parseOfKickoff(date: string, time?: string): number {
  if (!date) return 0;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dateMatch) return 0;
  const y = parseInt(dateMatch[1], 10);
  const mo = parseInt(dateMatch[2], 10) - 1;
  const d = parseInt(dateMatch[3], 10);
  if (!time) return Date.UTC(y, mo, d, 12, 0, 0);
  const tm = /^(\d{1,2}):(\d{2})\s*UTC\s*([+-]\d+)?$/.exec(time);
  if (!tm) return Date.UTC(y, mo, d, 12, 0, 0);
  const hh = parseInt(tm[1], 10);
  const mm = parseInt(tm[2], 10);
  const off = tm[3] ? parseInt(tm[3], 10) : 0;
  // Local kickoff is hh:mm at UTC+off, so UTC = hh - off (with date carry).
  const utcMs = Date.UTC(y, mo, d, hh, mm, 0);
  return utcMs - off * 3600 * 1000;
}

/** Knockout placeholders look like "W74" / "L51" / "RU1" until the group
 *  stage resolves them into real team names. Skip those so the board
 *  and bet popup don't show meaningless brackets. */
function isPlaceholderTeam(name: string): boolean {
  return /^[WLR]?[UNRWL]?\d{1,3}$/i.test(name.trim()) || /^[A-Z]{1,2}\d/.test(name.trim());
}

function parseOfMatch(m: OfMatch, idx: number, now: number): Fixture | null {
  const t1 = readTeam(m.team1);
  const t2 = readTeam(m.team2);
  if (!t1 || !t2 || !m.date) return null;
  if (isPlaceholderTeam(t1) || isPlaceholderTeam(t2)) return null;
  const kickoffMs = parseOfKickoff(m.date, m.time);
  if (!Number.isFinite(kickoffMs) || kickoffMs <= 0) return null;
  const ft = m.score?.ft ?? m.score?.et ?? null;
  // Status: FINISHED if a final score is in the JSON; IN_PLAY if we're
  // within ~2h after kickoff but the score hasn't arrived yet; else
  // SCHEDULED.
  let status: MatchStatus;
  if (ft) status = "FINISHED";
  else if (now >= kickoffMs && now < kickoffMs + 2 * 60 * 60 * 1000) status = "IN_PLAY";
  else status = "SCHEDULED";
  const scoreHome = ft?.[0] ?? 0;
  const scoreAway = ft?.[1] ?? 0;
  let result: Fixture["result"] = null;
  if (status === "FINISHED") {
    result = scoreHome > scoreAway ? "HOME" : scoreHome < scoreAway ? "AWAY" : "DRAW";
  }
  const minute = status === "IN_PLAY"
    ? Math.min(90, Math.max(1, Math.floor((now - kickoffMs) / 60_000)))
    : 0;
  // Read codes from the team object if OpenFootball ever provides them,
  // otherwise resolve via TEAM_CODES table.
  const t1c = typeof m.team1 === "object" && m.team1?.code ? m.team1.code : teamCode(t1);
  const t2c = typeof m.team2 === "object" && m.team2?.code ? m.team2.code : teamCode(t2);
  // Use a STABLE id based on the team names + date so a given match
  // keeps the same id across reads (so client-side bet records survive).
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]/g, "");
  const id = `wc-${m.date}-${safe(t1)}-${safe(t2)}-${idx}`;
  return {
    id,
    homeTeam: t1, awayTeam: t2,
    homeCode: t1c, awayCode: t2c,
    kickoffMs,
    status,
    scoreHome, scoreAway, minute, result,
  };
}

// ─── Module-level fetch cache ──────────────────────────────────────────────
// Both FixturePoller and StandingsPoller read from the same OpenFootball
// file. Fetch once, share across pollers. Refreshed every 30 min.

interface OfCache {
  fetchedAt: number;
  matches: OfMatch[];
}
let ofCache: OfCache | null = null;
let ofPendingFetch: Promise<void> | null = null;
let ofBackoffUntil = 0;
const OF_FETCH_INTERVAL_MS = 30 * 60 * 1000;

function ofFetch(): Promise<void> {
  if (ofPendingFetch) return ofPendingFetch;
  ofPendingFetch = (async () => {
    try {
      const data = await httpJson<OfRoot>(OF_PATH, {
        "User-Agent": "dressup-fair/1.0",
        "Accept": "application/json",
      }, OF_HOST);
      const matches = Array.isArray(data.matches) ? data.matches : [];
      if (matches.length > 0) {
        ofCache = { fetchedAt: Date.now(), matches };
      }
    } catch (err) {
      // Back off 30 min on error.
      ofBackoffUntil = Date.now() + 30 * 60 * 1000;
      console.warn("[openfootball] fetch failed:", (err as Error).message);
    } finally {
      ofPendingFetch = null;
    }
  })();
  return ofPendingFetch;
}

async function ofMaybeFetch(): Promise<void> {
  const now = Date.now();
  if (ofBackoffUntil > now) return;
  if (ofCache && now - ofCache.fetchedAt < OF_FETCH_INTERVAL_MS) return;
  await ofFetch();
}

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

function httpJson<T>(path: string, headers: Record<string, string>, host?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: host ?? OF_HOST,
      path,
      method: "GET",
      headers,
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`http ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(body) as T); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("http timeout")));
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
  private cache: Fixture[] = [];
  /** True when running against the no-network stub (no OF_HOST reachable). */
  private useStub = false;

  // Constructor signature kept for backward compat — opts.useStub forces
  // stub mode even with network available (handy for local-dev demos).
  constructor(opts: FixturePollerOpts = {}) {
    this.useStub = opts.useStub === true;
    if (this.useStub) {
      this.cache = buildStubFixtures();
    }
  }

  /** Return the current cached fixtures, sorted by kickoff time ascending. */
  getFixtures(): readonly Fixture[] {
    return this.cache;
  }

  /** Refresh the cache from the OpenFootball file (cached fetch shared
   *  with StandingsPoller). Cheap to call frequently — the module-level
   *  cache only re-fetches every 30 min. */
  async poll(): Promise<void> {
    if (this.useStub) {
      // Stub-only mode: drive demo fixtures forward in time.
      this.advanceStub();
      return;
    }
    await ofMaybeFetch();
    if (!ofCache) {
      // First fetch failed and the cache is empty — fall back to stub
      // so the UI has SOMETHING to show. Will switch over on next
      // successful fetch.
      if (this.cache.length === 0) this.cache = buildStubFixtures();
      return;
    }
    const now = Date.now();
    const fresh: Fixture[] = [];
    ofCache.matches.forEach((m, i) => {
      const f = parseOfMatch(m, i, now);
      if (f) fresh.push(f);
    });
    fresh.sort((a, b) => a.kickoffMs - b.kickoffMs);
    this.cache = fresh;
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

// ─── Standings poller ──────────────────────────────────────────────────────
// Group-stage standings for the World Cup. Polled at most ONCE PER DAY —
// standings don't change live (the fixture poller above handles live scores).
// Daily cadence is also gentle on the Football-Data.org rate budget.

interface FdStandingsRoot {
  standings?: Array<{
    stage?: string;
    type?: string;
    group?: string;
    table?: Array<{
      position?: number;
      team?: { name?: string; tla?: string };
      playedGames?: number;
      won?: number;
      draw?: number;
      lost?: number;
      goalsFor?: number;
      goalsAgainst?: number;
      goalDifference?: number;
      points?: number;
    }>;
  }>;
}

/** 2026 FIFA World Cup — 12 groups of 4, expanded format. Stub seed
 *  with realistic qualifiers; all teams start with 0-0-0 since the
 *  tournament hasn't begun. The real API replaces this verbatim when
 *  FOOTBALL_API_KEY is set. */
function buildStubStandings(): GroupStanding[] {
  const groups: Array<[string, Array<[string, string]>]> = [
    ["A", [["Mexico", "MEX"], ["Argentina", "ARG"], ["Croatia", "CRO"], ["Iran", "IRN"]]],
    ["B", [["USA", "USA"], ["Brazil", "BRA"], ["Belgium", "BEL"], ["Iraq", "IRQ"]]],
    ["C", [["Canada", "CAN"], ["Germany", "GER"], ["Senegal", "SEN"], ["Saudi Arabia", "KSA"]]],
    ["D", [["France", "FRA"], ["Japan", "JPN"], ["Morocco", "MAR"], ["Costa Rica", "CRC"]]],
    ["E", [["England", "ENG"], ["Spain", "ESP"], ["Nigeria", "NGA"], ["Panama", "PAN"]]],
    ["F", [["Portugal", "POR"], ["Switzerland", "SUI"], ["Australia", "AUS"], ["Qatar", "QAT"]]],
    ["G", [["Netherlands", "NED"], ["Italy", "ITA"], ["Ecuador", "ECU"], ["Tunisia", "TUN"]]],
    ["H", [["Uruguay", "URU"], ["Denmark", "DEN"], ["Colombia", "COL"], ["Ghana", "GHA"]]],
    ["I", [["Norway", "NOR"], ["Poland", "POL"], ["Egypt", "EGY"], ["Honduras", "HON"]]],
    ["J", [["Sweden", "SWE"], ["South Korea", "KOR"], ["Cameroon", "CMR"], ["Jamaica", "JAM"]]],
    ["K", [["Turkey", "TUR"], ["Serbia", "SRB"], ["Algeria", "ALG"], ["New Zealand", "NZL"]]],
    ["L", [["Austria", "AUT"], ["Wales", "WAL"], ["Ivory Coast", "CIV"], ["Paraguay", "PAR"]]],
  ];
  return groups.map(([group, teams]) => ({
    group,
    teams: teams.map(([name, code], i) => ({
      position: i + 1,
      team: name, code,
      played: 0, won: 0, draw: 0, lost: 0,
      goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0,
    })),
  }));
}

function parseFdStandings(data: FdStandingsRoot): GroupStanding[] {
  const out: GroupStanding[] = [];
  for (const s of data.standings ?? []) {
    // Only the group-stage "TOTAL" tables, not the home/away splits.
    if (s.type && s.type !== "TOTAL") continue;
    const grpRaw = s.group ?? "";
    if (!grpRaw.startsWith("GROUP_")) continue;
    const group = grpRaw.replace("GROUP_", "");
    const teams: TeamStanding[] = [];
    for (const t of s.table ?? []) {
      if (!t.team?.name) continue;
      teams.push({
        position: t.position ?? 0,
        team: t.team.name,
        code: (t.team.tla ?? t.team.name.slice(0, 3)).toUpperCase(),
        played: t.playedGames ?? 0,
        won: t.won ?? 0,
        draw: t.draw ?? 0,
        lost: t.lost ?? 0,
        goalsFor: t.goalsFor ?? 0,
        goalsAgainst: t.goalsAgainst ?? 0,
        goalDifference: t.goalDifference ?? 0,
        points: t.points ?? 0,
      });
    }
    if (teams.length > 0) out.push({ group, teams });
  }
  out.sort((a, b) => a.group.localeCompare(b.group));
  return out;
}

export class StandingsPoller {
  private cache: GroupStanding[] = [];
  private useStub = false;

  constructor(opts: FixturePollerOpts = {}) {
    this.useStub = opts.useStub === true;
    if (this.useStub) {
      this.cache = buildStubStandings();
    }
  }

  getStandings(): readonly GroupStanding[] {
    return this.cache;
  }

  /** Recompute standings from the shared OpenFootball cache. The
   *  fetch itself is throttled at the module level (30 min) — calling
   *  this every few minutes from event.ts is cheap when nothing changed. */
  async poll(): Promise<void> {
    if (this.useStub) {
      this.cache = buildStubStandings();
      return;
    }
    await ofMaybeFetch();
    if (!ofCache) {
      if (this.cache.length === 0) this.cache = buildStubStandings();
      return;
    }
    this.cache = computeStandingsFromMatches(ofCache.matches);
  }
}

/** Walk the match list and build a group-stage standings table.
 *  Knockout/round-of-32+ matches are skipped — they don't have group
 *  affiliation. For each group's table:
 *    sort by points DESC, then goal difference DESC, then goals for DESC.
 */
function computeStandingsFromMatches(matches: OfMatch[]): GroupStanding[] {
  interface TeamStat {
    team: string; code: string;
    played: number; won: number; draw: number; lost: number;
    goalsFor: number; goalsAgainst: number;
  }
  const groups = new Map<string, Map<string, TeamStat>>();

  function getOrInit(groupKey: string, teamName: string, code: string): TeamStat {
    let g = groups.get(groupKey);
    if (!g) { g = new Map(); groups.set(groupKey, g); }
    let t = g.get(teamName);
    if (!t) {
      t = {
        team: teamName, code,
        played: 0, won: 0, draw: 0, lost: 0,
        goalsFor: 0, goalsAgainst: 0,
      };
      g.set(teamName, t);
    }
    return t;
  }

  for (const m of matches) {
    // Group stage only — OpenFootball labels groups as e.g. "Group A".
    const rawGroup = (m.group ?? "").trim();
    if (!rawGroup.toLowerCase().startsWith("group ")) continue;
    const groupKey = rawGroup.slice(6).trim().toUpperCase();  // "A"..
    const t1 = readTeam(m.team1);
    const t2 = readTeam(m.team2);
    if (!t1 || !t2) continue;
    const code1 = typeof m.team1 === "object" && m.team1?.code ? m.team1.code : teamCode(t1);
    const code2 = typeof m.team2 === "object" && m.team2?.code ? m.team2.code : teamCode(t2);
    // Even teams that haven't played yet must appear in the table so
    // every group shows 4 rows from day one. We seed them with zeros
    // here regardless of score presence.
    const s1 = getOrInit(groupKey, t1, code1);
    const s2 = getOrInit(groupKey, t2, code2);

    const ft = m.score?.ft ?? m.score?.et ?? null;
    if (!ft) continue;
    const gh = ft[0];
    const ga = ft[1];
    s1.played += 1;
    s2.played += 1;
    s1.goalsFor += gh; s1.goalsAgainst += ga;
    s2.goalsFor += ga; s2.goalsAgainst += gh;
    if (gh > ga) { s1.won += 1; s2.lost += 1; }
    else if (gh < ga) { s2.won += 1; s1.lost += 1; }
    else { s1.draw += 1; s2.draw += 1; }
  }

  const out: GroupStanding[] = [];
  for (const [group, teamMap] of groups) {
    const teams: TeamStanding[] = [];
    for (const s of teamMap.values()) {
      teams.push({
        position: 0,  // assigned after sort
        team: s.team, code: s.code,
        played: s.played, won: s.won, draw: s.draw, lost: s.lost,
        goalsFor: s.goalsFor, goalsAgainst: s.goalsAgainst,
        goalDifference: s.goalsFor - s.goalsAgainst,
        points: s.won * 3 + s.draw,
      });
    }
    // Sort: points DESC → GD DESC → GF DESC → name ASC for stable tiebreak
    teams.sort((a, b) =>
      b.points - a.points
      || b.goalDifference - a.goalDifference
      || b.goalsFor - a.goalsFor
      || a.team.localeCompare(b.team),
    );
    teams.forEach((t, i) => { (t as { position: number }).position = i + 1; });
    out.push({ group, teams });
  }
  out.sort((a, b) => a.group.localeCompare(b.group));
  return out;
}
