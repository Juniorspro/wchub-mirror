import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { injectGameConfigPlugin } from '@rezona/core/vite/inject-game-config'

export default defineConfig({
  plugins: [injectGameConfigPlugin(), react()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
