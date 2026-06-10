// ============================================================================
// game.config.ts — Dressup Lounge (multiplayer chat-room sandbox)
//
// Pure-data single source of truth (no imports of ./game/ or @colyseus/schema).
// World coords here are XZ on the Babylon ground plane (Y is up = constant).
// The framework treats them as a 2D rectangle for clamping; client maps
// width→X and height→Z when positioning meshes.
// ============================================================================

export const gameConfig = {
  /** Colyseus room name */
  roomName: "dressup-lounge",

  /** Cozy lounge size — 12 avatars fit comfortably */
  maxPlayers: 12,

  /** Tick rate — lower than an arena since there's no combat */
  tickHz: 20,

  /** Colyseus listen port */
  port: 2567,

  /** Idle sleep delay — generous for a chat room */
  sleepAfter: "10m",

  /** World footprint in Babylon ground-plane units (XZ).
   *  width → X axis, height → Z axis. Y (up) is constant.
   *  Players are clamped to (0, 0) → (width, height). The map is now
   *  recentered horizontally: stadium center sits at x=110 (the map
   *  midline), so the east and west fences are equidistant from it.
   *  Old layout had x=400 east boundary with stadium at x=24 — wildly
   *  asymmetric, with empty grass east of the content. */
  world: { width: 200, height: 175 },

  /** Where new players spawn — a few units south of the plaza
   *  centerpiece monument (which is at (110, 24) with a 1.6-unit
   *  hitbox). Spawning AT the centerpiece would put new players
   *  inside the collision circle. Spawn at (110, 19) sits on the
   *  plaza disc just south of the monument. */
  spawn: { x: 110, y: 19 },

  /** Player walking speed in world units per second */
  player: { speed: 6 },

  /** Production worker host (placeholder until deploy) */
  prodHost: "dressup-fair.rezona-394.workers.dev",
} as const;

export type GameConfig = typeof gameConfig;

export function serializeClientConfig(): string {
  const clientView = {
    roomName: gameConfig.roomName,
    maxPlayers: gameConfig.maxPlayers,
    tickHz: gameConfig.tickHz,
    port: gameConfig.port,
    world: gameConfig.world,
    prodHost: gameConfig.prodHost,
  };
  return `window.GAME_CONFIG = ${JSON.stringify(clientView)};`;
}

export default gameConfig;
