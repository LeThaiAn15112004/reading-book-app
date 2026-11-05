import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const workspaceRoot = path.resolve(__dirname, '../../..')
const desktopRoot = path.join(workspaceRoot, 'apps/reading-book-desktop')
// The one install folder at the repository root (spec 009): one React 19 for the UI bundle.
const rootNodeModules = path.join(workspaceRoot, '..', 'node_modules')
// pdf.js 5 calls ES2025 APIs (`Uint8Array#toHex` in the worker's fingerprint) that Android System WebView older than
// Chrome 140 lacks ("a.toHex is not a function" in Expo Go). Its legacy build polyfills them; Desktop's Electron keeps
// the modern build. Mobile-only, so the UI source is unchanged.
const pdfjsLegacy = path.join(rootNodeModules, 'pdfjs-dist/legacy/build').replaceAll('\\', '/')

/** Tailwind scans from the Vite root, which is here, so Desktop's stylesheet is told where the UI source is. */
function scanDesktopUiForTailwind(): Plugin {
  const stylesheet = path.join(desktopRoot, 'src/index.css').replaceAll('\\', '/')
  const source = path.join(desktopRoot, 'src').replaceAll('\\', '/')
  return {
    name: 'readmate:scan-desktop-ui',
    enforce: 'pre',
    transform(code, id) {
      if (id.split('?')[0] !== stylesheet) return null
      return `${code}\n@source "${source}";\n`
    },
  }
}

export default defineConfig({
  root: __dirname,
  // Keep Vite's cache in the one install folder, never a second node_modules under web/ (spec 009 FR-006).
  cacheDir: path.join(rootNodeModules, '.vite/mobile-web'),
  base: './',
  publicDir: path.join(desktopRoot, 'public'),
  resolve: {
    alias: [
      { find: '@reading-book/config', replacement: path.join(workspaceRoot, 'core/src/config') },
      { find: '@reading-book/book-reader-sdk', replacement: path.join(workspaceRoot, 'core/src/index.ts') },
      { find: /^pdfjs-dist$/, replacement: `${pdfjsLegacy}/pdf.mjs` },
      { find: /^pdfjs-dist\/build\/pdf\.worker\.min\.mjs(\?url)?$/, replacement: `${pdfjsLegacy}/pdf.worker.min.mjs$1` },
      { find: /^react(\/.*)?$/, replacement: `${path.join(rootNodeModules, 'react').replaceAll('\\', '/')}$1` },
      { find: /^react-dom(\/.*)?$/, replacement: `${path.join(rootNodeModules, 'react-dom').replaceAll('\\', '/')}$1` },
    ],
  },
  plugins: [scanDesktopUiForTailwind(), tailwindcss(), react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
