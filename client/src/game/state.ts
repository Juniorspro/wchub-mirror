// ══════════════════════════════════════════════
// GameState: platform state adapter snapshot.
// The Babylon runtime publishes its visual state to the HUD via
// src/store.ts; this file only keeps a read-only compatibility shape.
// ══════════════════════════════════════════════

export interface GameState {
  readonly frame: number;
  readonly elapsed: number;
  readonly ready: boolean;
}
