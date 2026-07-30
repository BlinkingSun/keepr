import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Renderer only. The main and preload bundles are built with esbuild in
// scripts/build.mjs, because they are Node/Electron targets rather than browser
// targets and mixing the two in one Vite config obscures which externals apply
// to which.
export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src/ui'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
  },
})
