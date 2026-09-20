import { defineConfig } from 'vite'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@reading-book/config': path.resolve(__dirname, '../../packages/config'),
      '@reading-book/book-reader-sdk': path.resolve(__dirname, '../book-reader-sdk/src/index.ts'),
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
          main: 'electron/main.ts',
          'book-chunk.worker': 'electron/chunking/book-chunk.worker.ts',
        },
        vite: {
          resolve: {
            alias: {
              '@reading-book/config': path.resolve(__dirname, '../../packages/config'),
              '@reading-book/book-reader-sdk': path.resolve(__dirname, '../book-reader-sdk/src/index.ts'),
            },
          },
          build: {
            rollupOptions: {
              external: ['better-sqlite3'],
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
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
