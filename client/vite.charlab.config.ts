// Build del laboratorio de personaje (charlab/) — entrada independiente.
//   dev:    npm run dev:charlab
//   build:  SINGLEFILE=1 npm run build:charlab
//   armor:  python3 scripts/armor.py dist-charlab
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.resolve(dir, 'charlab'),
  base: './',
  plugins: process.env.SINGLEFILE === '1' ? [viteSingleFile({ removeViteModuleLoader: true })] : [],
  server: {
    host: '0.0.0.0',
    port: 5175,
  },
  build: {
    outDir: path.resolve(dir, 'dist-charlab'),
    emptyOutDir: true,
    assetsInlineLimit: process.env.SINGLEFILE === '1' ? 100_000_000 : 4096,
  },
})
