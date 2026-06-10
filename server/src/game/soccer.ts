// ============================================================================
// game/soccer.ts — Server-authoritative kickable ball on the soccer pitch.
//
// Geometry: pitch is centered at (158, 32) in world XZ, 18×26 units. Goals
// are 5 units wide centered on x=158 at z=19 (south) and z=45 (north).
//
// Sync model: ball state (x, z, vx, vy) is high-frequency motion data —
// not in the Colyseus @type schema. Instead we run a 20Hz tick inside this
// room and broadcast `ball:state` ONLY when the ball is moving or just
// changed state (kick / goal / reset). At-rest = zero outbound bytes,
// matching the rest of this room's bandwidth discipline.
//
// Kicks: players don't send explicit kick messages. The input message
// handler in messages.ts already validates + applies player movement;
// the same handler calls maybeKickBall() here whenever a moving player's
// position lands within KICK_RADIUS of the ball. The ball gets a kick
// impulse based on the player's input direction, capped at BALL_MAX_SPEED.
//
// Goals: when the ball crosses a goal line within the goal-mouth x-range,
// we broadcast `ball:goal` { scorerSid, scorerName, side: 'N'|'S' } and
// reset the ball to center. Clients increment a local counter + show a
// banner; coin reward is applied by the scorer's client on receiving
// the event with their own sid (no schema mutation needed).
// ============================================================================

import { Room } from "colyseus";
import { GameState } from "./state";

// ─── Field geometry ────────────────────────────────────────────────────────

const FIELD_CX = 158;
const FIELD_CZ = 32;
const FIELD_HALF_W = 9;
const FIELD_HALF_D = 13;
const GOAL_HALF_W = 2.5;

// ─── Ball tunables ─────────────────────────────────────────────────────────

const BALL_RADIUS = 0.28;
const KICK_RADIUS = 0.95;
const KICK_STRENGTH = 9;      // m/s of impulse per unit of input velocity
const BALL_MAX_SPEED = 26;    // m/s — caps any single kick
const BALL_FRICTION = 0.965;  // velocity scalar per tick (20Hz)
const BALL_STOP_VEL = 0.08;   // below this magnitude → snap to zero
const TICK_MS = 50;
const DT = TICK_MS / 1000;

// No coin reward for goals — the pitch is purely-for-fun social play,
// not a coin grind. Server still broadcasts `ball:goal` so the banner
// + scoreboard fire, but `reward` is always 0 and the scorer's client
// is a no-op.
const GOAL_REWARD_COINS = 0;

// ─── Public registration ───────────────────────────────────────────────────

export interface SoccerBallController {
  /** Called from the input handler each time a player position changes.
   *  Checks if the player is touching the ball and applies a kick if so. */
  maybeKickBall(
    sid: string,
    name: string,
    px: number,
    pz: number,
    inputVx: number,
    inputVy: number,
  ): void;
  stop: () => void;
}

export function registerSoccerBall(
  room: Room<GameState>,
  _state: GameState,
): SoccerBallController {
  // Ball state — closure-scoped, never module-level.
  let bx = FIELD_CX;
  let bz = FIELD_CZ;
  let bvx = 0;
  let bvy = 0;
  let lastKickerSid = "";
  let lastKickerName = "";

  // Score: total goals scored on each side. Broadcast on change.
  let scoreN = 0;
  let scoreS = 0;

  // Snapshot the last broadcast so we don't spam identical state.
  let lastBroadcast = { bx, bz, bvx, bvy };

  function isMoving(): boolean {
    return bvx !== 0 || bvy !== 0;
  }

  function snapshot() {
    return {
      x: bx,
      z: bz,
      vx: bvx,
      vy: bvy,
      kicker: lastKickerSid,
      kickerName: lastKickerName,
      scoreN,
      scoreS,
    };
  }

  function broadcastBall(force = false) {
    if (
      !force &&
      bx === lastBroadcast.bx &&
      bz === lastBroadcast.bz &&
      bvx === lastBroadcast.bvx &&
      bvy === lastBroadcast.bvy
    ) {
      return;
    }
    lastBroadcast = { bx, bz, bvx, bvy };
    room.broadcast("ball:state", snapshot());
  }

  function resetBall() {
    bx = FIELD_CX;
    bz = FIELD_CZ;
    bvx = 0;
    bvy = 0;
    lastKickerSid = "";
    lastKickerName = "";
    broadcastBall(true);
  }

  // ── Initial-snapshot handlers: new joiners need the current state ──
  room.onMessage("ball:request", (client) => {
    client.send("ball:state", snapshot());
  });

  // ── Tick loop ──────────────────────────────────────────────────────
  const interval = setInterval(() => {
    if (!isMoving()) return;  // at rest → zero work, zero bytes

    // Integrate position
    bx += bvx * DT;
    bz += bvy * DT;

    // Goal check BEFORE bounce, so a goal-line ball doesn't bounce back
    const inGoalXRange = Math.abs(bx - FIELD_CX) < GOAL_HALF_W;
    const overSouthLine = bz <= FIELD_CZ - FIELD_HALF_D + BALL_RADIUS;
    const overNorthLine = bz >= FIELD_CZ + FIELD_HALF_D - BALL_RADIUS;

    if (inGoalXRange && (overSouthLine || overNorthLine)) {
      const side: "N" | "S" = overNorthLine ? "N" : "S";
      if (side === "N") scoreN += 1;
      else scoreS += 1;

      // Announce goal — clients show banner; scorer's client awards coins.
      room.broadcast("ball:goal", {
        scorerSid: lastKickerSid,
        scorerName: lastKickerName,
        side,
        scoreN,
        scoreS,
        reward: GOAL_REWARD_COINS,
      });

      resetBall();
      return;
    }

    // Bounce off field walls (energy loss factor on each bounce)
    const minX = FIELD_CX - FIELD_HALF_W + BALL_RADIUS;
    const maxX = FIELD_CX + FIELD_HALF_W - BALL_RADIUS;
    const minZ = FIELD_CZ - FIELD_HALF_D + BALL_RADIUS;
    const maxZ = FIELD_CZ + FIELD_HALF_D - BALL_RADIUS;
    if (bx < minX) {
      bx = minX;
      bvx = -bvx * 0.55;
    } else if (bx > maxX) {
      bx = maxX;
      bvx = -bvx * 0.55;
    }
    if (bz < minZ) {
      bz = minZ;
      bvy = -bvy * 0.55;
    } else if (bz > maxZ) {
      bz = maxZ;
      bvy = -bvy * 0.55;
    }

    // Friction
    bvx *= BALL_FRICTION;
    bvy *= BALL_FRICTION;
    if (Math.hypot(bvx, bvy) < BALL_STOP_VEL) {
      bvx = 0;
      bvy = 0;
    }

    broadcastBall();
  }, TICK_MS);

  return {
    maybeKickBall(
      sid: string,
      name: string,
      px: number,
      pz: number,
      inputVx: number,
      inputVy: number,
    ) {
      const dx = bx - px;
      const dz = bz - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > KICK_RADIUS) return;

      const inputMag = Math.hypot(inputVx, inputVy);
      if (inputMag < 0.15) return;  // standing still — no kick

      // Apply impulse in the direction of the player's input.
      bvx += inputVx * KICK_STRENGTH;
      bvy += inputVy * KICK_STRENGTH;

      // Cap to BALL_MAX_SPEED
      const sp = Math.hypot(bvx, bvy);
      if (sp > BALL_MAX_SPEED) {
        const s = BALL_MAX_SPEED / sp;
        bvx *= s;
        bvy *= s;
      }

      // Push the ball away from the player so they don't immediately
      // re-collide on the next tick. Just enough to clear the kick
      // radius by ~5 cm.
      if (dist > 0.001) {
        const push = KICK_RADIUS - dist + 0.05;
        bx += (dx / dist) * push;
        bz += (dz / dist) * push;
      }

      lastKickerSid = sid;
      lastKickerName = name;
      broadcastBall(true);
    },
    stop() {
      clearInterval(interval);
    },
  };
}
