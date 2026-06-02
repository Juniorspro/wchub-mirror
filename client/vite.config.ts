import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { injectGameConfigPlugin } from '@rezona/core/vite/inject-game-config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // injectGameConfigPlugin reads server/src/game.config.ts and exposes it
  // as window.GAME_CONFIG so the net client can pick up the room name + port.
  plugins: [injectGameConfigPlugin(), react()],
  base: './',
  resolve: {
    alias: {
      // ★ Multiplayer key: client reuses server/src/shared physics/constants/protocol
      //   so server step() and client prediction call the same movePlayer.
      '@shared': path.resolve(dir, '../server/src/shared'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
