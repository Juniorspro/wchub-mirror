// ============================================================================
// game/simulation.ts — Dressup Lounge tick
//
// No combat, no projectiles, no per-tick collision — players move purely on
// input messages (handled in messages.ts via @shared/math.movePlayer).
// The tick exists to advance state.tick (for snapshot timestamps) and is the
// hook for any future ambient simulation (NPCs, day/night, music sync, etc.).
// ============================================================================

import { GameState } from "./state";

export function step(state: GameState): void {
  state.tick++;
}
