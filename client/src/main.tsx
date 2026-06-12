import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './hub.css'
import HubApp from './HubApp'

// ⚽ WORLD CUP HUB v2 — el remake es ahora EL juego del repo.
// (El client original queda en el árbol — App.tsx/babylon/net — por si
// hay que consultarlo, pero la entrada compila y sirve el juego nuevo.)
// El online del hub se conecta solo: ?ws= → maplab_ws → WCHUB_WS →
// mismo host (Worker) → localhost:2567 en dev.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HubApp />
  </StrictMode>,
)

// Cover screenshot ready signal (lo usa la captura de portada de Rezona)
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    ;(window as unknown as { __REZONA_CAPTURE_READY__?: boolean }).__REZONA_CAPTURE_READY__ = true
  })
})
