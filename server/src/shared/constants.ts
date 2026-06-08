/**
 * [INPUT]: none
 * [OUTPUT]: tick + world + movement constants shared by server step() and client predict.
 * [POS]: server/src/shared/constants.ts — single source of truth for runtime values.
 * [PROTOCOL]: keep in sync with game.config.ts (TICK_HZ, MAP_W/H, PLAYER_SPEED).
 */

// Tick rate — must match game.config.tickHz
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

// World footprint in Babylon ground-plane units (XZ). Must match game.config.world.
// Bug history: these were left at 48/48 when game.config.world grew. The
// client uses these to fill `meta.mapW`/`meta.mapH`, which feeds the
// movePlayer clamp inside client-side prediction. So even though the
// server happily moved the player out to (200, 110), the client kept
// snapping them back at (48, 48). KEEP THESE IN SYNC WITH game.config.world.
export const MAP_W = 220;
export const MAP_H = 220;

// Player walking speed in world units per second (must match game.config.player.speed)
export const PLAYER_SPEED = 6;
export const PLAYER_R = 0.5;

// ── Client-side sync buffers (smooth other-player rendering despite jitter) ──
/** Interpolation delay: render snapshots this many ms behind real time. */
export const SNAPSHOT_DELAY_MS = 120;
/** Snapshot ring buffer capacity. */
export const SNAPSHOT_BUFFER_CAP = 30;
/** Pending input queue cap (prevents unbounded growth). */
export const PENDING_INPUTS_CAP = 120;
/** Self-prediction snap distance (world units): beyond this, hard-snap to authoritative position. */
export const SELF_SNAP_DISTANCE = 3;
