// ============================================================================
// game/simulation.ts — Dressup Lounge tick
//
// No combat, no projectiles, no per-tick collision — players move purely on
// input messages (handled in messages.ts via @shared/math.movePlayer). The
// step exists as the hook for any future ambient simulation (NPCs, day/night,
// music sync, etc.). It used to advance state.tick every call, but:
//   1. The client never read state.tick (it does `state.t || performance.now()`
//      and the schema field is named `tick`, not `t` — a years-old typo).
//   2. Bumping it every tick generated a 20Hz keepalive schema patch even
//      when zero players were moving — meaningful for bad connections.
// So the bump is gone. An idle room with stationary players now produces
// genuinely zero outbound bytes.
// ============================================================================

import { GameState } from "./state";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function step(_state: GameState): void {
  // intentionally empty — see header
}
