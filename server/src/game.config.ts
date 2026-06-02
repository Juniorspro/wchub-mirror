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
   *  width → X axis, height → Z axis. Y (up) is constant. */
  world: { width: 24, height: 24 },

  /** Player walking speed in world units per second */
  player: { speed: 4 },

  /** Production worker host (placeholder until deploy) */
  prodHost: "your-game-name-xxxxxxxx.rezona-394.workers.dev",
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
