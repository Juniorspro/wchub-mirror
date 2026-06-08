// ============================================================================
// game/state.ts — Dressup Lounge state schema
//
// HOT path only. The schema is the high-frequency motion channel — every
// field here is diffed and re-broadcast at the patch rate (~15Hz). So we
// keep it minimum-viable: position + aim only.
//
// COLD fields (username, color, outfit) used to live here too, which meant
// every outfit-change re-broadcast a ~900-byte CSV to every peer. They now
// ride event-driven `roster-*` messages (see messages.ts). The Player object
// still carries non-@type mirrors of these so server logic can read them,
// but they're never auto-synced.
//
// BANDWIDTH: alive is also gone from the schema — no death/respawn mechanic
// exists in this game, so it's a constant true. Re-introduce as @type if a
// future game adds combat.
// ============================================================================

import { Schema, MapSchema, type } from "@colyseus/schema";
import { gameConfig } from "../game.config";

export class Player extends Schema {
  // ── HOT (synced via schema, 15Hz patches) ────────────────────────────────
  // Position on the lounge floor — the server treats it as 2D (x, y), and
  // the Babylon client maps server.y → mesh.position.z (ground-plane axis).
  // Babylon's vertical (up) axis isn't synced; everyone shares one ground level.
  @type("number") x: number = 12;
  @type("number") y: number = 12;
  // Facing direction in radians (rotation around Babylon Y-up axis).
  @type("number") aim: number = 0;

  // ── COLD (server-only mirror; broadcast via `roster-*` messages) ─────────
  // Read by server logic, fan'd out by messages.ts on join / equip / rename.
  // NOT @type — these never enter the per-tick patch.
  username: string = "anon";
  color: string = "#7bb6e8";
  alive: boolean = true;
  textureItems: string =
    "skin-light,shirt-white-tee,pants-blue-jeans,shoes-white-sneakers";
  accessoryItems: string = "";
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") code: string = "";
  // BANDWIDTH: `tick` was here as @type("number") and bumped every server
  // step — generating a 20Hz keepalive patch even with zero player motion.
  // It's gone now (no consumer ever read it; the client cast accessed
  // `state.t` not `state.tick` — a years-old typo).
}

// A small palette of friendly avatar tint colors picked per join — gives every
// player a visible nameplate/indicator hue without needing client-side guessing.
const COLOR_PALETTE = [
  "#e8a374", "#c9c2e8", "#f5e092", "#9ed5b1",
  "#f0a8a8", "#7bb6e8", "#dcb3e8", "#a8d8b9",
];
function pickColor(): string {
  return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
}

/** Drop a fresh player at the lounge plaza with a small spawn jitter. */
export function spawnAt(p: Player): void {
  const { spawn } = gameConfig;
  p.x = spawn.x + (Math.random() - 0.5) * 6;
  p.y = spawn.y + (Math.random() - 0.5) * 6;
  p.aim = Math.random() * Math.PI * 2;
  p.color = pickColor();
  p.alive = true;
}
