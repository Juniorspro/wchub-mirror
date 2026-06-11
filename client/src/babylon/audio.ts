// ══════════════════════════════════════════════
// Babylon runtime audio bridge.
// Prefer the unlock and SFX capabilities provided by @rezona/core/3d; if
// the host audio is unavailable, degrade silently so the visible scene is
// never blocked by audio failure.
// ══════════════════════════════════════════════

import { bgm, ensureAudioReady, sfx } from '@rezona/core/3d';

export interface GameAudioHandle {
  unlock(): void;
  collect(): void;
  /** Switch the looping background track. De-dupes by URL, so callers can
   *  invoke it every frame from a zone check — only an actual zone change
   *  restarts playback. Safe before audio unlock: the engine queues the
   *  pending track and starts it on the unlock callback (the landing
   *  page's Enter click calls ensureAudioReady). */
  playBgm(url: string | undefined): void;
  dispose(): void;
}

export function createGameAudio(): GameAudioHandle {
  let disposed = false;
  let currentBgmUrl: string | null = null;

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
    playBgm(url) {
      if (disposed || !url || url === currentBgmUrl) return;
      currentBgmUrl = url;
      try {
        // volume is linear gain (engine converts to dB) — BGM sits under
        // the procedural SFX so gameplay feedback stays readable.
        void bgm.play(url, { loop: true, volume: 0.5 });
      } catch {
        // Missing/undecodable track must never block the scene.
      }
    },
    dispose() {
      disposed = true;
      try {
        bgm.stop();
      } catch {
        // ignore
      }
    },
  };
}
