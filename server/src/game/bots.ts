// ============================================================================
// game/bots.ts — offline/ambient bot players for the Dressup Lounge.
//
// Bots are ordinary Players in the schema (added via the same addPlayer
// contract), driven by synthesized "input" messages fed through the REAL
// input handler in messages.ts — so they obey identical validation,
// movePlayer physics and soccer kick rules as humans.
//
// Used today by the client's offline FakeRoom (client/src/net/fake-colyseus).
// Server-side use later: call createBotDriver from registerMessages behind an
// env flag and feed driver.tick() into the same handler. No module-level
// mutable state — per-room brains live in the driver closure.
//
// Field geometry mirrors soccer.ts (private there) — keep in sync.
// ============================================================================
import { GameState } from "./state";

const FIELD_CX = 158;
const FIELD_CZ = 32;
const FIELD_HALF_D = 13;

export interface BotDef {
  sid: string;
  name: string;
  textureItems: string;
  accessoryItems: string;
  soccer: boolean;
}

export const BOT_DEFS: BotDef[] = [
  { sid: "bot:0", name: "SkibidiFan", soccer: true,
    textureItems: "skin-tan,jersey-argentina,pants-red-shorts,shoes-white-sneakers",
    accessoryItems: "glasses-shades" },
  { sid: "bot:1", name: "DonGol", soccer: true,
    textureItems: "skin-deep,jersey-brazil,pants-gray-sweats,shoes-red-trainers",
    accessoryItems: "" },
  { sid: "bot:2", name: "ElWachin", soccer: true,
    textureItems: "skin-light,jersey-germany,pants-black-slacks,shoes-black-boots",
    accessoryItems: "hat-cap" },
  { sid: "bot:3", name: "TungTung", soccer: false,
    textureItems: "skin-mint,shirt-blue-hoodie,pants-blue-jeans,shoes-yellow-sandals",
    accessoryItems: "face-happy" },
  { sid: "bot:4", name: "Sigma9", soccer: true,
    textureItems: "skin-tan,jersey-croatia,pants-red-shorts,shoes-red-trainers",
    accessoryItems: "glasses-sport" },
  { sid: "bot:5", name: "PixelPibe", soccer: false,
    textureItems: "skin-light,shirt-logo-tee,pants-khaki-cargo,shoes-brown-loafers",
    accessoryItems: "hat-beanie,face-cool" },
];

export function spawnBots(
  state: GameState,
  addPlayerFn: (state: GameState, sid: string, opts: { name?: string; textureItems?: string; accessoryItems?: string }) => void,
): void {
  for (const d of BOT_DEFS) {
    addPlayerFn(state, d.sid, {
      name: d.name,
      textureItems: d.textureItems,
      accessoryItems: d.accessoryItems,
    });
  }
}

export interface BallView { x: number; z: number; vx: number; vy: number }
export interface BotInputMsg { vx: number; vy: number; aim: number; seq: number }

interface Brain {
  tx: number; tz: number;
  retargetAt: number;
  celebrateUntil: number;
}

/** Per-room driver factory (brains live in this closure, never module level).
 *  tick(nowMs) returns one input message per living bot, computed from the
 *  live schema positions + the last broadcast ball state. */
export function createBotDriver(
  state: GameState,
  getBall: () => BallView | null,
) {
  const brains = new Map<string, Brain>();

  const insidePitch = (x: number, z: number): boolean =>
    Math.abs(x - FIELD_CX) < 10.5 && Math.abs(z - FIELD_CZ) < 14.5;

  function pickWanderTarget(b: Brain, now: number): void {
    // Wander spots NEVER land inside the pitch — strolling through it would
    // kick the ball in random directions on every crossing.
    for (let tries = 0; tries < 8; tries++) {
      const zone = Math.random();
      if (zone < 0.40) {        // touchline spectating spots
        const side = Math.random() < 0.5 ? -1 : 1;
        b.tx = FIELD_CX + side * (11.5 + Math.random() * 4);
        b.tz = FIELD_CZ + (Math.random() - 0.5) * 24;
      } else if (zone < 0.75) { // plaza
        b.tx = 102 + Math.random() * 16;
        b.tz = 14 + Math.random() * 22;
      } else {                  // stroll the lanes between
        b.tx = 100 + Math.random() * 70;
        b.tz = 10 + Math.random() * 50;
      }
      if (!insidePitch(b.tx, b.tz)) break;
    }
    b.retargetAt = now + 4000 + Math.random() * 6000;
  }

  return {
    celebrate(ms: number): void {
      const now = Date.now();
      for (const b of brains.values()) b.celebrateUntil = now + ms + Math.random() * 800;
    },
    tick(now: number): Array<{ sid: string; msg: BotInputMsg }> {
      const out: Array<{ sid: string; msg: BotInputMsg }> = [];
      const ball = getBall();
      // One chaser at a time: the closest soccer bot within range. The rest
      // wander — no rugby scrum around the ball.
      let chaserSid: string | null = null;
      if (ball) {
        let best = 18;
        for (const d of BOT_DEFS) {
          if (!d.soccer) continue;
          const p = state.players.get(d.sid);
          if (!p) continue;
          const dist = Math.hypot(ball.x - p.x, ball.z - p.y);
          if (dist < best) { best = dist; chaserSid = d.sid; }
        }
      }
      for (const d of BOT_DEFS) {
        const p = state.players.get(d.sid);
        if (!p) continue;
        let b = brains.get(d.sid);
        if (!b) {
          b = { tx: p.x, tz: p.y, retargetAt: 0, celebrateUntil: 0 };
          brains.set(d.sid, b);
        }
        if (now < b.celebrateUntil) {
          // spin in place — aim sweeps, no movement
          out.push({ sid: d.sid, msg: { vx: 0, vy: 0, aim: (now / 160) % 6.2832, seq: 0 } });
          continue;
        }
        const isChaser = chaserSid === d.sid && !!ball;
        if (isChaser && ball) {
          // Two-phase striker: far from the ball -> run to a spot BEHIND it
          // (relative to the target goal); on the ball -> aim THROUGH it at
          // the goal so the walk-into-ball kick (soccer.ts uses the input
          // direction) sends it goalward.
          const gz = ball.z > FIELD_CZ ? FIELD_CZ - FIELD_HALF_D : FIELD_CZ + FIELD_HALF_D;
          const gxv = FIELD_CX - ball.x, gzv = gz - ball.z;
          const gl = Math.hypot(gxv, gzv) || 1;
          const bd = Math.hypot(ball.x - p.x, ball.z - p.y);
          const goalwardSpeed = (ball.vx * gxv + ball.vy * gzv) / gl;
          if (goalwardSpeed > 2.5) {
            // ball is already rolling at the goal — trail it, don't touch it
            b.tx = ball.x - (gxv / gl) * 2.5;
            b.tz = ball.z - (gzv / gl) * 2.5;
          } else {
            // Strike only when the approach line points at the goal —
            // otherwise orbit to the spot behind the ball first. This keeps
            // every kick goalward instead of glancing sideways.
            const adx = (ball.x - p.x) / (bd || 1), adz = (ball.z - p.y) / (bd || 1);
            const aligned = adx * (gxv / gl) + adz * (gzv / gl) > 0.82;
            if (bd <= 2.2 && aligned) {
              b.tx = ball.x + (gxv / gl) * 2.0;
              b.tz = ball.z + (gzv / gl) * 2.0;
            } else {
              b.tx = ball.x - (gxv / gl) * (bd > 2.2 ? 0.9 : 1.4);
              b.tz = ball.z - (gzv / gl) * (bd > 2.2 ? 0.9 : 1.4);
            }
          }
        } else if (now >= b.retargetAt) {
          pickWanderTarget(b, now);
        }
        let dx = b.tx - p.x, dz = b.tz - p.y;
        if (!isChaser && ball) {
          const bdx = ball.x - p.x, bdz = ball.z - p.y;
          const bdd = Math.hypot(bdx, bdz);
          if (bdd < 2.4 && bdd > 0.001) {
            // veer perpendicular to the ball so a stroll never nudges it
            dx = -bdz / bdd; dz = bdx / bdd;
          }
        }
        const dist = Math.hypot(dx, dz);
        // The chaser never idles — its through-the-ball target must be
        // walked INTO so the proximity kick fires.
        if (dist < 0.6 && !isChaser) {
          out.push({ sid: d.sid, msg: { vx: 0, vy: 0, aim: p.aim, seq: 0 } });
          continue;
        }
        const chase = isChaser;
        const k = (chase ? 1 : 0.55) / dist;
        out.push({ sid: d.sid, msg: {
          vx: dx * k, vy: dz * k,
          aim: Math.atan2(dx, dz), seq: 0,
        } });
      }
      return out;
    },
  };
}
