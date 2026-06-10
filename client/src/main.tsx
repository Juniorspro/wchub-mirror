import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Inject window.GAME_CONFIG before App mounts. The framework's vite plugin
// (@rezona/core/vite/inject-game-config) should normally do this, but it
// isn't intercepting /game.config.js under the current dev setup — so we
// just hard-code the values here, kept in sync with server/src/game.config.ts.
// Production deploy via Cloudflare Worker injects the real values.
declare global {
  // eslint-disable-next-line no-var
  var GAME_CONFIG: {
    roomName: string;
    maxPlayers: number;
    tickHz: number;
    port: number;
    world: { width: number; height: number };
    prodHost: string;
  } | undefined;
}
if (typeof window !== 'undefined' && !(window as unknown as { GAME_CONFIG?: unknown }).GAME_CONFIG) {
  (window as unknown as { GAME_CONFIG: unknown }).GAME_CONFIG = {
    roomName: 'dressup-lounge',
    maxPlayers: 12,
    tickHz: 20,
    port: 2567,
    world: { width: 200, height: 175 },
    prodHost: 'dressup-fair.rezona-394.workers.dev',
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Cover screenshot ready signal: double rAF guarantees the first frame has painted
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    ;(window as unknown as { __REZONA_CAPTURE_READY__?: boolean }).__REZONA_CAPTURE_READY__ = true
  })
})
