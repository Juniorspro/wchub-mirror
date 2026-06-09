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
import { FixturePoller, Fixture, StandingsPoller, GroupStanding } from "./fixtures";

// ─── Tunables ──────────────────────────────────────────────────────────────

/** Bet window opens this many ms before kick-off. */
const BET_OPEN_MS = 8 * 60 * 1000;   // 8 minutes
/** Minimum stake per bet (in coins). */
const MIN_BET = 10;
/** Maximum stake per bet. */
const MAX_BET = 200;
/** Minimum players in the room before events run. */
const MIN_PLAYERS = 1;  // Phase 1: keep low so it's testable solo

/** SERVER milestone ladder — collective goal. Every bet contributes to
 *  a server-wide pool (room-scoped, since one Container = one room).
 *  When the pool crosses a threshold, every player who's ever placed
 *  a bet in this session receives the listed coin reward instantly.
 *  Thresholds raised significantly so the ladder represents real
 *  long-tail collective contribution — players bring large coin
 *  balances; the old 100-6000 ladder ate through in minutes. */
const SERVER_MILESTONES = [
  { threshold:   1000, reward:   30, label: "First Thousand" },
  { threshold:   5000, reward:  100, label: "Five Thousand Pool" },
  { threshold:  15000, reward:  200, label: "Fifteen K Mark" },
  { threshold:  40000, reward:  500, label: "Forty K Tier" },
  { threshold: 100000, reward: 1500, label: "Hundred K Champion" },
] as const;

/** PERSONAL milestone ladder — your individual contribution to the
 *  pool across the session. Smaller thresholds with smaller rewards,
 *  so each player has their own incremental progression on top of
 *  the shared server ladder. Each player's contribution is the sum
 *  of every bet they've placed (regardless of outcome). */
const PERSONAL_MILESTONES = [
  { threshold:   50, reward:  10, label: "Backer" },
  { threshold:  200, reward:  30, label: "Supporter" },
  { threshold:  500, reward:  75, label: "Patron" },
  { threshold: 1500, reward: 200, label: "Champion" },
  { threshold: 5000, reward: 500, label: "Legend" },
] as const;

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
  const standingsPoller = new StandingsPoller();
  const phases = new Map<string, MatchPhase>();
  let stopped = false;

  // ─── Server-wide top-up pool ────────────────────────────────────────────
  // Sum of every bet placed in this room session. Drives the SERVER
  // milestone ladder. Resets only when the Container restarts.
  let globalPool = 0;
  // Tiers (by index into SERVER_MILESTONES) that have crossed.
  const unlockedMilestones = new Set<number>();
  // Session ids that have placed at least one bet — eligible for the
  // server-wide milestone rewards when new tiers cross.
  const everBet = new Set<string>();

  // ─── Per-player contribution tracking ─────────────────────────────────
  // Each player's lifetime contribution (sum of their bet amounts) in
  // this session. Drives the PERSONAL milestone ladder — they unlock
  // their own tier rewards independently from the server ladder.
  const playerContribution = new Map<string, number>();
  // Per-player unlocked-tier indexes into PERSONAL_MILESTONES.
  const playerUnlockedTiers = new Map<string, Set<number>>();
  // Most-recent bet per player — drives the top-voters board's team
  // column. Overwrites on every new bet from that player.
  const playerMostRecentBet = new Map<string, {
    matchId: string; camp: Camp; teamName: string; teamCode: string;
  }>();

  function broadcastTopVoters(): void {
    // Sort by contribution DESC, take top 10. Look up name from state
    // at broadcast time so renames flow through correctly.
    const entries: Array<{
      sid: string; name: string; contribution: number;
      team: string; teamCode: string; camp: string;
    }> = [];
    for (const [sid, contribution] of playerContribution) {
      const p = state.players.get(sid);
      if (!p) continue;
      const recent = playerMostRecentBet.get(sid);
      entries.push({
        sid,
        name: p.username,
        contribution,
        team: recent?.teamName ?? "",
        teamCode: recent?.teamCode ?? "",
        camp: recent?.camp ?? "",
      });
    }
    entries.sort((a, b) => b.contribution - a.contribution);
    room.broadcast("event:top-voters", { entries: entries.slice(0, 10) });
  }
  function sendTopVoters(client: { send(t: string, m: unknown): void }): void {
    const entries: Array<{
      sid: string; name: string; contribution: number;
      team: string; teamCode: string; camp: string;
    }> = [];
    for (const [sid, contribution] of playerContribution) {
      const p = state.players.get(sid);
      if (!p) continue;
      const recent = playerMostRecentBet.get(sid);
      entries.push({
        sid,
        name: p.username,
        contribution,
        team: recent?.teamName ?? "",
        teamCode: recent?.teamCode ?? "",
        camp: recent?.camp ?? "",
      });
    }
    entries.sort((a, b) => b.contribution - a.contribution);
    client.send("event:top-voters", { entries: entries.slice(0, 10) });
  }

  function broadcastPool(): void {
    room.broadcast("event:pool-update", {
      pool: globalPool,
      unlocked: Array.from(unlockedMilestones).sort((a, b) => a - b),
    });
  }
  function sendPool(client: { send(t: string, m: unknown): void }): void {
    client.send("event:pool-update", {
      pool: globalPool,
      unlocked: Array.from(unlockedMilestones).sort((a, b) => a - b),
    });
  }

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

    // SERVER pool: add this bet to the global tally + check for newly
    // crossed server milestones. Pay out INSTANTLY to every player
    // who has ever bet (Top-Hero collective-reward pattern).
    globalPool += amount;
    everBet.add(client.sessionId);
    for (let i = 0; i < SERVER_MILESTONES.length; i++) {
      if (unlockedMilestones.has(i)) continue;
      const m = SERVER_MILESTONES[i];
      if (globalPool < m.threshold) continue;
      unlockedMilestones.add(i);
      for (const sid of everBet) {
        const c = room.clients.find((rc) => rc.sessionId === sid);
        if (c) {
          c.send("event:milestone-reward", {
            scope: "server",
            tier: i, threshold: m.threshold, reward: m.reward, label: m.label,
          });
        }
      }
      room.broadcast("event:milestone-unlocked", {
        scope: "server",
        tier: i, threshold: m.threshold, label: m.label, reward: m.reward,
      });
    }

    // PERSONAL pool: add this bet to the player's lifetime contribution
    // + check their own milestones. Each player has their own ladder;
    // rewards are sent ONLY to this player (no broadcast).
    const sid = client.sessionId;
    const prevContrib = playerContribution.get(sid) ?? 0;
    const newContrib = prevContrib + amount;
    playerContribution.set(sid, newContrib);
    let myUnlocked = playerUnlockedTiers.get(sid);
    if (!myUnlocked) { myUnlocked = new Set(); playerUnlockedTiers.set(sid, myUnlocked); }
    for (let i = 0; i < PERSONAL_MILESTONES.length; i++) {
      if (myUnlocked.has(i)) continue;
      const m = PERSONAL_MILESTONES[i];
      if (newContrib < m.threshold) continue;
      myUnlocked.add(i);
      client.send("event:milestone-reward", {
        scope: "personal",
        tier: i, threshold: m.threshold, reward: m.reward, label: m.label,
      });
    }
    // Send the player their updated personal stats (contribution +
    // unlocked tiers). Targeted — other clients don't need to know.
    client.send("event:personal-update", {
      contribution: newContrib,
      unlocked: Array.from(myUnlocked).sort((a, b) => a - b),
    });

    // Update the player's most-recent-bet record for the top-voters
    // board, then broadcast the new sorted top-10.
    const teamName = camp === "HOME" ? fixture.homeTeam
      : camp === "AWAY" ? fixture.awayTeam
      : "Draw";
    const teamCode = camp === "HOME" ? fixture.homeCode
      : camp === "AWAY" ? fixture.awayCode
      : "DRAW";
    playerMostRecentBet.set(sid, { matchId, camp, teamName, teamCode });
    broadcastTopVoters();

    broadcastPool();

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

  function broadcastStandings(): void {
    room.broadcast("event:standings", { groups: standingsPoller.getStandings() });
  }
  /** Send standings directly to one client (used on join). */
  function sendStandings(client: { send(type: string, msg: unknown): void }): void {
    client.send("event:standings", { groups: standingsPoller.getStandings() });
  }

  // Daily standings refresh — kicked off lazy, polled in the same tick.
  // The poller's own throttle ensures the actual HTTP fetch happens at
  // most once per 24h regardless of how often we ask.
  let lastStandingsBroadcastAt = 0;
  function pollAndMaybeBroadcastStandings(): void {
    void standingsPoller.poll().then(() => {
      // Broadcast hourly to all rooms regardless — covers cases where a
      // new client joins between API pulls, AND surfaces background
      // standings changes after the initial 24h refresh window.
      const now = Date.now();
      if (now - lastStandingsBroadcastAt > 60 * 60 * 1000) {
        lastStandingsBroadcastAt = now;
        broadcastStandings();
      }
    });
  }
  // Kick once at start.
  pollAndMaybeBroadcastStandings();
  // ... and re-check every 5 min (the poller itself only fetches every 24h).
  const standingsInterval = setInterval(pollAndMaybeBroadcastStandings, 5 * 60 * 1000);

  // Send the current snapshot to every new joiner.
  room.onMessage("event:request-fixtures", (client) => {
    // Also send the latest standings — same channel, single round-trip.
    sendStandings(client);
    // ... and the top-up pool snapshot so the monument paints right
    // on first frame.
    sendPool(client);
    // ... and the player's personal contribution + unlocked tiers
    // (0 / empty for first-time joiners).
    const sid = client.sessionId;
    const contrib = playerContribution.get(sid) ?? 0;
    const unlocked = playerUnlockedTiers.get(sid);
    client.send("event:personal-update", {
      contribution: contrib,
      unlocked: unlocked ? Array.from(unlocked).sort((a, b) => a - b) : [],
    });
    // Top-voters snapshot.
    sendTopVoters(client);
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
      clearInterval(standingsInterval);
    },
  };
}
