// ============================================================================
// game/index.ts — 6-function contract for Dressup Lounge
// ============================================================================

import { GameState, Player, spawnAt } from "./state";
import { registerMessages } from "./messages";
import { step } from "./simulation";
import { decodeIdentity } from "../plugins/auth/identity";
import { attachIdentity, detachIdentity } from "../plugins/storage";

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
  // Host-App identity (token + platform gameId in join opts, see client
  // bridge.ts getAccessToken/getGameId). decode-only + per-room WeakMap
  // registry — the token NEVER enters the schema (it would broadcast to
  // every client). Browser guests have no token → null → no-op; they play
  // fine, nothing persists on their behalf.
  attachIdentity(state, sessionId, decodeIdentity(opts));
  spawnAt(p);
  state.players.set(sessionId, p);
}

export function removePlayer(state: GameState, sessionId: string): void {
  detachIdentity(state, sessionId);
  state.players.delete(sessionId);
}

export function playerCount(state: GameState): number {
  return state.players.size;
}
