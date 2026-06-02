import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

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
