// ============================================================================
// game/event.ts — Match-betting event state machine, one per room.
//
// Drives the betting lifecycle off real (or stub) match fixtures:
//
//   AWAIT_BET   (t-kickoff > BET_OPEN_MS) — banner only, no bets accepted
//   BET_WINDOW  (BET_OPEN_MS > t-kickoff > 0) — popup open, bets accepted
//   LIVE        (match status IN_PLAY/PAUSED) — bets closed, live score
//   RESOLVED    (match status FINISHED) — payouts computed + broadcast
//
// The currently-active match is the NEXT one in the schedule that hasn't
// resolved yet. When it resolves, we automatically advance to the next.
//
// Bets are in-memory only (no DB). The server doesn't track player coin
// balances — clients say "I'm betting X" and we record it; on payout we
// fan out per-player coins via a targeted message. Clients update their
// own localStorage-backed balance. Self-cheating is bounded: a client
// that under-records its bet can't gain extra; one that over-records
// just loses the bet.
// ============================================================================

import { Room } from "colyseus";
import { GameState } from "./state";
import { FixturePoller, Fixture } from "./fixtures";

// ─── Tunables ──────────────────────────────────────────────────────────────

/** Bet window opens this many ms before kick-off. */
const BET_OPEN_MS = 8 * 60 * 1000;   // 8 minutes
/** Minimum stake per bet (in coins). */
const MIN_BET = 10;
/** Maximum stake per bet. */
const MAX_BET = 200;
/** Minimum players in the room before events run. */
const MIN_PLAYERS = 1;  // Phase 1: keep low so it's testable solo

// ─── Bet types ─────────────────────────────────────────────────────────────

type Camp = "HOME" | "DRAW" | "AWAY";

interface Bet {
  sid: string;
  camp: Camp;
  amount: number;
  /** Display name at bet time (preserved through any later rename). */
  name: string;
}

interface MatchPhase {
  matchId: string;
  phase: "AWAIT_BET" | "BET_WINDOW" | "LIVE" | "RESOLVED";
  /** All bets placed for this match (one per sid, last write wins). */
  bets: Map<string, Bet>;
}

// ─── State machine driver ──────────────────────────────────────────────────

export function registerBettingEvent(
  room: Room<GameState>,
  state: GameState,
): { stop: () => void } {
  const poller = new FixturePoller();
  const phases = new Map<string, MatchPhase>();
  let stopped = false;

  function getPhase(matchId: string): MatchPhase {
    let p = phases.get(matchId);
    if (!p) {
      p = { matchId, phase: "AWAIT_BET", bets: new Map() };
      phases.set(matchId, p);
    }
    return p;
  }

  function broadcastFixtures(): void {
    const now = Date.now();
    const fixtures = poller.getFixtures().filter((f) => {
      // Hide fixtures that finished more than 60s ago — they've already
      // resolved, no reason to keep them in the client's list.
      if (f.status === "FINISHED" && now - f.kickoffMs > 100 * 60 * 1000) return false;
      return true;
    });
    room.broadcast("event:fixtures", {
      fixtures: fixtures.map((f) => ({
        id: f.id,
        homeTeam: f.homeTeam, awayTeam: f.awayTeam,
        homeCode: f.homeCode, awayCode: f.awayCode,
        kickoffMs: f.kickoffMs,
        status: f.status,
        scoreHome: f.scoreHome, scoreAway: f.scoreAway,
        minute: f.minute,
        result: f.result,
        // Pool sizes (so clients can show live odds)
        poolHome: poolSize(f.id, "HOME"),
        poolDraw: poolSize(f.id, "DRAW"),
        poolAway: poolSize(f.id, "AWAY"),
        countHome: countByCamp(f.id, "HOME"),
        countDraw: countByCamp(f.id, "DRAW"),
        countAway: countByCamp(f.id, "AWAY"),
        phase: phases.get(f.id)?.phase ?? "AWAIT_BET",
      })),
      t: now,
    });
  }

  function poolSize(matchId: string, camp: Camp): number {
    const p = phases.get(matchId);
    if (!p) return 0;
    let s = 0;
    for (const b of p.bets.values()) if (b.camp === camp) s += b.amount;
    return s;
  }
  function countByCamp(matchId: string, camp: Camp): number {
    const p = phases.get(matchId);
    if (!p) return 0;
    let c = 0;
    for (const b of p.bets.values()) if (b.camp === camp) c += 1;
    return c;
  }

  // Receive bets from clients.
  room.onMessage("event:bet", (client, msg: { matchId?: unknown; camp?: unknown; amount?: unknown } | undefined) => {
    if (state.players.size < MIN_PLAYERS) return;
    const matchId = typeof msg?.matchId === "string" ? msg.matchId : "";
    const camp = (msg?.camp === "HOME" || msg?.camp === "DRAW" || msg?.camp === "AWAY") ? msg.camp : null;
    const rawAmount = typeof msg?.amount === "number" ? msg.amount : Number(msg?.amount);
    if (!matchId || !camp || !Number.isFinite(rawAmount)) return;
    const amount = Math.floor(rawAmount);
    if (amount < MIN_BET || amount > MAX_BET) return;
    const fixture = poller.getFixtures().find((f) => f.id === matchId);
    if (!fixture) return;
    // Only accept bets in the BET_WINDOW for this match.
    const now = Date.now();
    const timeToKickoff = fixture.kickoffMs - now;
    if (timeToKickoff <= 0 || timeToKickoff > BET_OPEN_MS) return;
    if (fixture.status !== "SCHEDULED" && fixture.status !== "TIMED") return;

    const player = state.players.get(client.sessionId);
    if (!player) return;

    const phase = getPhase(matchId);
    // Allow one bet per player per match — replace prior bets if any.
    phase.bets.set(client.sessionId, {
      sid: client.sessionId,
      camp,
      amount,
      name: player.username,
    });

    // Confirm to the sender so they know it landed + the (now-deducted)
    // amount is real. Client deducts from local balance on confirmation.
    client.send("event:bet-ok", { matchId, camp, amount });
    // Broadcast new pool sizes for live-odds display.
    room.broadcast("event:bet-update", {
      matchId,
      poolHome: poolSize(matchId, "HOME"),
      poolDraw: poolSize(matchId, "DRAW"),
      poolAway: poolSize(matchId, "AWAY"),
      countHome: countByCamp(matchId, "HOME"),
      countDraw: countByCamp(matchId, "DRAW"),
      countAway: countByCamp(matchId, "AWAY"),
    });
  });

  // Tick: poll fixtures, advance phases, resolve finished matches.
  let lastBroadcastAt = 0;
  const tickInterval = setInterval(() => {
    if (stopped) return;
    void poller.poll().then(() => {
      const now = Date.now();
      let mustBroadcast = false;
      for (const f of poller.getFixtures()) {
        const p = getPhase(f.id);
        const timeToKickoff = f.kickoffMs - now;
        let newPhase: MatchPhase["phase"] = p.phase;
        if (f.status === "FINISHED" && p.phase !== "RESOLVED") {
          // Resolve payouts (see below) and mark resolved.
          resolveMatch(f, p);
          newPhase = "RESOLVED";
          mustBroadcast = true;
        } else if (f.status === "IN_PLAY" || f.status === "PAUSED") {
          newPhase = "LIVE";
        } else if (timeToKickoff > 0 && timeToKickoff <= BET_OPEN_MS) {
          newPhase = "BET_WINDOW";
        } else if (timeToKickoff <= 0) {
          // Past kick-off but status still SCHEDULED (e.g. delayed
          // refresh) — treat as LIVE so bets close.
          newPhase = "LIVE";
        } else {
          newPhase = "AWAIT_BET";
        }
        if (newPhase !== p.phase) {
          p.phase = newPhase;
          mustBroadcast = true;
        }
      }
      // Re-broadcast at least every 10s so late-joiners get fresh data.
      if (mustBroadcast || now - lastBroadcastAt > 10_000) {
        broadcastFixtures();
        lastBroadcastAt = now;
      }
    });
  }, 5000);

  function resolveMatch(fixture: Fixture, p: MatchPhase): void {
    const result = fixture.result;
    if (!result) return;
    // Pari-mutuel: winners split the total pot in proportion to their
    // stake within the winning camp. If no one bet on the winning camp,
    // refund everyone in full.
    let totalPot = 0;
    let winnersPool = 0;
    for (const b of p.bets.values()) {
      totalPot += b.amount;
      if (b.camp === result) winnersPool += b.amount;
    }
    const payouts: Array<{ sid: string; amount: number; profit: number; camp: Camp }> = [];
    if (winnersPool > 0) {
      for (const b of p.bets.values()) {
        if (b.camp === result) {
          const payout = Math.floor((b.amount / winnersPool) * totalPot);
          payouts.push({ sid: b.sid, amount: payout, profit: payout - b.amount, camp: b.camp });
        } else {
          payouts.push({ sid: b.sid, amount: 0, profit: -b.amount, camp: b.camp });
        }
      }
    } else {
      // Nobody picked the winning side — refund everyone in full.
      for (const b of p.bets.values()) {
        payouts.push({ sid: b.sid, amount: b.amount, profit: 0, camp: b.camp });
      }
    }
    // Targeted result to each player who bet (so they update local balance),
    // plus a broadcast summary so spectators see the outcome.
    for (const po of payouts) {
      const sid = po.sid;
      const client = room.clients.find((c) => c.sessionId === sid);
      if (client) {
        client.send("event:resolve-self", {
          matchId: fixture.id,
          result,
          payout: po.amount,
          profit: po.profit,
          camp: po.camp,
        });
      }
    }
    room.broadcast("event:resolve", {
      matchId: fixture.id,
      result,
      scoreHome: fixture.scoreHome,
      scoreAway: fixture.scoreAway,
      totalPot,
      winnersCount: payouts.filter((p) => p.profit > 0).length,
    });
  }

  // Send the current snapshot to every new joiner.
  room.onMessage("event:request-fixtures", (client) => {
    const now = Date.now();
    const fixtures = poller.getFixtures();
    client.send("event:fixtures", {
      fixtures: fixtures.map((f) => ({
        id: f.id,
        homeTeam: f.homeTeam, awayTeam: f.awayTeam,
        homeCode: f.homeCode, awayCode: f.awayCode,
        kickoffMs: f.kickoffMs,
        status: f.status,
        scoreHome: f.scoreHome, scoreAway: f.scoreAway,
        minute: f.minute,
        result: f.result,
        poolHome: poolSize(f.id, "HOME"),
        poolDraw: poolSize(f.id, "DRAW"),
        poolAway: poolSize(f.id, "AWAY"),
        countHome: countByCamp(f.id, "HOME"),
        countDraw: countByCamp(f.id, "DRAW"),
        countAway: countByCamp(f.id, "AWAY"),
        phase: phases.get(f.id)?.phase ?? "AWAIT_BET",
      })),
      t: now,
    });
  });

  // Kick off an initial poll so the first broadcast has data.
  void poller.poll().then(() => broadcastFixtures());

  return {
    stop() {
      stopped = true;
      clearInterval(tickInterval);
    },
  };
}
