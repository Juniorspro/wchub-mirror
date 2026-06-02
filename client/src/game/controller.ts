// ══════════════════════════════════════════════
// GameController: platform compatibility-layer placeholder.
// The Babylon scene lifecycle is owned by src/babylon/game.ts; this class
// does not create its own World or systems.
// ══════════════════════════════════════════════

import type { GameState } from './state';

export class GameController {
  private state: GameState = {
    frame: 0,
    elapsed: 0,
    ready: false,
  };

  init(): void {}

  dispose(): void {}

  setState(patch: Partial<GameState>): void {
    this.state = { ...this.state, ...patch };
  }

  getState(): Readonly<GameState> {
    return this.state;
  }

  reset(): void {
    this.state = {
      frame: 0,
      elapsed: 0,
      ready: false,
    };
  }
}
