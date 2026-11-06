import { defineConfig } from 'vite'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
const appRoot = path.resolve(__dirname, '../../app')

export default defineConfig({
  // Spec 009 T038: the UI lives in source/app, so that folder is the Vite root; everything Desktop-owned stays here.
  root: appRoot,
  publicDir: path.resolve(__dirname, 'public'),
  build: { outDir: path.resolve(__dirname, 'dist'), emptyOutDir: true },
  // Spec 009: Vite's cache lives in the one install folder at the repository root, never in a node_modules here.
  cacheDir: path.resolve(__dirname, '../../../node_modules/.vite/desktop'),
  resolve: {
    alias: {
      '@app': appRoot,
      '@reading-book/config': path.resolve(__dirname, '../../core/src/config'),
      '@reading-book/book-reader-sdk': path.resolve(__dirname, '../../core/src/index.ts'),
    },
  },
  optimizeDeps: {
    include: ['epubjs', 'jszip'],
    exclude: ['foliate-js'],
  },
  plugins: [
    tailwindcss(),
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        // The chunking worker is its own entry so `new Worker()` can load `book-chunk.worker.js`
        // from dist-electron, next to main.js.
        entry: {
          main: path.join(__dirname, 'electron/main.ts'),
          'book-chunk.worker': path.join(__dirname, 'electron/chunking/book-chunk.worker.ts'),
          'translation.worker': path.join(__dirname, 'electron/translation/translation.worker.ts'),
          'transcription.process': path.join(__dirname, 'electron/transcription/transcription.process.ts'),
          'pdf-annotation-scan.worker': path.join(__dirname, 'electron/pdf-sync/pdf-annotation-scan.worker.ts'),
        },
        vite: {
          resolve: {
            alias: {
              '@reading-book/config': path.resolve(__dirname, '../../core/src/config'),
              '@reading-book/book-reader-sdk': path.resolve(__dirname, '../../core/src/index.ts'),
            },
          },
          build: {
            outDir: path.join(__dirname, 'dist-electron'),
            rollupOptions: {
              // Native / huge packages load from node_modules at runtime instead of being bundled
              // (ONNX Runtime ships .node binaries that Rollup can't inline).
              // pdfjs-dist: the chunk worker loads its Node (`legacy`) build from node_modules.
              external: [
                'better-sqlite3',
                '@huggingface/transformers',
                'onnxruntime-node',
                'sharp',
                // MP3 tags / cover at import. Bundled, its CommonJS dependencies (`debug` → `require('tty')`)
                // make the whole Main bundle throw at load; from node_modules they resolve normally.
                'music-metadata',
                /^pdfjs-dist(\/|$)/,
              ],
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: { build: { outDir: path.join(__dirname, 'dist-electron') } },
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
        // renderer: process.env.NODE_ENV === 'test'
        //   // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        //   ? undefined
        //   : {},
    }),
  ],
})
