// Build del laboratorio de mapa (maplab/) — entrada independiente del juego.
//   dev:    npx vite -c vite.maplab.config.ts
//   build:  SINGLEFILE=1 npx vite build -c vite.maplab.config.ts
//   armor:  python3 scripts/armor.py dist-maplab
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.resolve(dir, 'maplab'),
  base: './',
  plugins: process.env.SINGLEFILE === '1' ? [viteSingleFile({ removeViteModuleLoader: true })] : [],
  server: {
    host: '0.0.0.0',
    port: 5174,
  },
  build: {
    outDir: path.resolve(dir, 'dist-maplab'),
    emptyOutDir: true,
    // SINGLEFILE=1: assets como data: URL → un solo HTML autocontenido.
    assetsInlineLimit: process.env.SINGLEFILE === '1' ? 100_000_000 : 4096,
  },
})
