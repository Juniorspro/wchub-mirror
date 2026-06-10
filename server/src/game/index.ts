// ============================================================================
// game/index.ts — 6-function contract for Dressup Lounge
// ============================================================================

import { GameState, Player, spawnAt } from "./state";
import { registerMessages } from "./messages";
import { step } from "./simulation";

export { registerMessages, step };
export type { GameState } from "./state";

export function createState(code: string): GameState {
  const state = new GameState();
  state.code = code;
  return state;
}

export function addPlayer(
  state: GameState,
  sessionId: string,
  opts: { name?: string; username?: string; textureItems?: string; accessoryItems?: string },
): void {
  const p = new Player();
  // Accept either `name` or `username` from join opts for backward compat.
  p.username = String(opts?.username ?? opts?.name ?? "anon").slice(0, 16);
  // Optional initial outfit carried in joinOpts (so a returning player can
  // walk in already wearing what they had). Server still validates on
  // explicit `equip` messages — see messages.ts.
  // Cap matches messages.ts MAX_LOOK_LEN-sized look ids plus a few
  // catalog ids — the old 256 cap silently truncated pixel-art look
  // ids carried back in by returning players.
  if (typeof opts?.textureItems === "string") p.textureItems = opts.textureItems.slice(0, 2800);
  if (typeof opts?.accessoryItems === "string") p.accessoryItems = opts.accessoryItems.slice(0, 256);
  spawnAt(p);
  state.players.set(sessionId, p);
}

export function removePlayer(state: GameState, sessionId: string): void {
  state.players.delete(sessionId);
}

export function playerCount(state: GameState): number {
  return state.players.size;
}
