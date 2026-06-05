// ============================================================================
// game/state.ts — Dressup Lounge state schema
//
// Authoritative fields only (every player must agree on these). Visual-only
// state (camera, eye-blink, particles, HUD animation) stays client-local and
// is NOT in the schema.
//
// Outfit: serialized as comma-separated lists. Two strings keep the schema
// flat — clients parse them into texture / accessory id arrays when they
// invoke actor.applyOutfit.
// ============================================================================

import { Schema, MapSchema, type } from "@colyseus/schema";
import { gameConfig } from "../game.config";

export class Player extends Schema {
  // Position on the lounge floor — the server treats it as 2D (x, y), and
  // the Babylon client maps server.y → mesh.position.z (ground-plane axis).
  // Babylon's vertical (up) axis isn't synced; everyone shares one ground level.
  @type("number") x: number = 12;
  @type("number") y: number = 12;
  // Facing direction in radians (rotation around Babylon Y-up axis).
  @type("number") aim: number = 0;

  // Framework-standard fields (PlayerSnapshot expects these to exist).
  @type("string") username: string = "anon";
  @type("string") color: string = "#7bb6e8";
  @type("boolean") alive: boolean = true;

  // Outfit — CSV of item ids. Clients call actor.applyOutfit after parsing.
  @type("string") textureItems: string =
    "skin-light,shirt-white-tee,pants-blue-jeans,shoes-white-sneakers";
  @type("string") accessoryItems: string = "";

  // Acknowledged input seq (for self-prediction reconciliation).
  @type("number") ack: number = 0;
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("number") tick: number = 0;
  @type("string") code: string = "";
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
