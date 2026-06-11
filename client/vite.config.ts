import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { injectGameConfigPlugin } from '@rezona/core/vite/inject-game-config'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  define: {
    // server plugins read process.env.* (auth secret, storage base URL);
    // browser builds resolve them to undefined.
    'process.env.AUTH_ACCESS_SECRET': 'undefined',
    'process.env.GAME_STORAGE_BASE_URL': 'undefined',
    'process.env': '{}',
  },
  // injectGameConfigPlugin reads server/src/game.config.ts and exposes it
  // as window.GAME_CONFIG so the net client can pick up the room name + port.
  plugins: [injectGameConfigPlugin(), react(), ...(process.env.SINGLEFILE === '1' ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
  base: './',
  resolve: {
    alias: {
      // ★ Multiplayer key: client reuses server/src/shared physics/constants/protocol
      //   so server step() and client prediction call the same movePlayer.
      '@shared': path.resolve(dir, '../server/src/shared'),
      // Offline mode: the in-browser FakeRoom bundles the real server game
      // layer; '@server' resolves it, 'colyseus' maps the server-only lib
      // (imported as a type in game/*) to a tiny browser shim.
      '@server': path.resolve(dir, '../server/src'),
      'colyseus': path.resolve(dir, 'src/server-shims/colyseus.ts'),
      // server/src files resolve node deps relative to themselves (outside
      // the client root) — pin the three they use to client/node_modules.
      'obscenity': path.resolve(dir, 'node_modules/obscenity'),
      'jose': path.resolve(dir, 'node_modules/jose'),
      '@colyseus/schema': path.resolve(dir, 'node_modules/@colyseus/schema'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // SINGLEFILE=1: every asset becomes a data: URL so the whole game fits
    // in one self-contained HTML (Juniors-style offline build).
    assetsInlineLimit: process.env.SINGLEFILE === '1' ? 100_000_000 : 4096,
  },
})
