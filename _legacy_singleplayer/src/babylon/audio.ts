// ══════════════════════════════════════════════
// Babylon runtime audio bridge.
// Prefer the unlock and SFX capabilities provided by @rezona/core/3d; if
// the host audio is unavailable, degrade silently so the visible scene is
// never blocked by audio failure.
// ══════════════════════════════════════════════

import { ensureAudioReady, sfx } from '@rezona/core/3d';

export interface GameAudioHandle {
  unlock(): void;
  collect(): void;
  dispose(): void;
}

export function createGameAudio(): GameAudioHandle {
  let disposed = false;

  return {
    unlock() {
      if (disposed) return;
      try {
        ensureAudioReady();
      } catch {
        // Audio unlock failure must not block the Babylon runtime.
      }
    },
    collect() {
      if (disposed) return;
      try {
        sfx.collect();
      } catch {
        // SFX is supplemental feedback; degrade silently when unavailable.
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
