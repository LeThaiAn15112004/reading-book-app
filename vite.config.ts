import { defineConfig } from 'vite'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
const appRoot = path.resolve(__dirname, './source/app')
// The Desktop host (Main, Preload, assets, build output); Electron is started on this folder, whose package.json names the app.
const hostRoot = path.join(appRoot, 'platforms/electron')

// vite-plugin-electron reads the `package.json` of the working directory (ES module output when it says `"type": "module"`),
// so Vite runs from the Desktop host folder: `cd source/app/platforms/electron && vite --config ../../../../vite.config.ts`
// (spec 009 T047). The repository root's package.json is Expo's.
const electronPlugins =
    electron({
      main: {
        // Started on the host folder (its package.json: name = userData folder, main = dist-electron/main.js), not on the repository root, whose package.json is Expo's.
        onstart: ({ startup }) => void startup([hostRoot, '--no-sandbox']),
        // Shortcut of `build.lib.entry`.
        // The chunking worker is its own entry so `new Worker()` can load `book-chunk.worker.js`
        // from dist-electron, next to main.js.
        entry: {
          main: path.join(hostRoot, 'main.ts'),
          'book-chunk.worker': path.join(hostRoot, 'chunking/book-chunk.worker.ts'),
          'translation.worker': path.join(hostRoot, 'translation/translation.worker.ts'),
          'transcription.process': path.join(hostRoot, 'transcription/transcription.process.ts'),
          'pdf-annotation-scan.worker': path.join(hostRoot, 'pdf-sync/pdf-annotation-scan.worker.ts'),
        },
        vite: {
          resolve: {
            alias: [
              { find: /^@core$/, replacement: path.resolve(__dirname, './source/core/src/index.ts') },
              { find: /^@core\//, replacement: `${path.resolve(__dirname, './source/core/src').replaceAll('\\', '/')}/` },
            ],
          },
          build: {
            outDir: path.join(hostRoot, 'dist-electron'),
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
        input: path.join(hostRoot, 'preload.ts'),
        vite: { build: { outDir: path.join(hostRoot, 'dist-electron') } },
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
        // renderer: process.env.NODE_ENV === 'test'
        //   // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        //   ? undefined
        //   : {},
    })

export default defineConfig({
  // Spec 009 T038/T047: the UI lives in source/app, so that folder is the Vite root; everything Desktop-owned is in hostRoot.
  root: appRoot,
  publicDir: path.join(hostRoot, 'public'),
  build: { outDir: path.join(hostRoot, 'dist'), emptyOutDir: true },
  // Spec 009: Vite's cache lives in the one install folder at the repository root.
  cacheDir: path.resolve(__dirname, './node_modules/.vite/desktop'),
  server: {
    // The host folder holds build output (release/ is hundreds of MB), E2E results and spikes: nothing there is UI source.
    watch: { ignored: ['**/platforms/electron/{release,dist,dist-electron,e2e,spikes,resources}/**'] },
  },
  resolve: {
    // Research R4: the host's own suffix wins, so `host.electron.ts` is chosen for `host`.
    extensions: ['.electron.tsx', '.electron.ts', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    alias: [
      { find: /^@app\//, replacement: `${appRoot.replaceAll('\\', '/')}/` },
      { find: /^@core$/, replacement: path.resolve(__dirname, './source/core/src/index.ts') },
      { find: /^@core\//, replacement: `${path.resolve(__dirname, './source/core/src').replaceAll('\\', '/')}/` },
    ],
  },
  optimizeDeps: {
    include: ['epubjs', 'jszip'],
    exclude: ['foliate-js'],
  },
  plugins: [tailwindcss(), react(), electronPlugins],
})
