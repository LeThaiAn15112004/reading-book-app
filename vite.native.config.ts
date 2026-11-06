import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const workspaceRoot = path.resolve(__dirname, './source')
const appRoot = path.join(workspaceRoot, 'app')
// The Mobile host folder: index.html, main.ts, the bridge and stores of the WebView; the build lands in its web-dist/.
const nativeRoot = path.join(appRoot, 'platforms/native')
// The one install folder at the repository root (spec 009): one React 19 for the UI bundle.
const rootNodeModules = path.join(__dirname, 'node_modules')
// pdf.js 5 calls ES2025 APIs (`Uint8Array#toHex` in the worker's fingerprint) that Android System WebView older than
// Chrome 140 lacks ("a.toHex is not a function" in Expo Go). Its legacy build polyfills them; Desktop's Electron keeps
// the modern build. Mobile-only, so the UI source is unchanged.
const pdfjsLegacy = path.join(rootNodeModules, 'pdfjs-dist/legacy/build').replaceAll('\\', '/')

/** Tailwind scans from the Vite root, which is here, so Desktop's stylesheet is told where the UI source is. */
function scanDesktopUiForTailwind(): Plugin {
  const stylesheet = path.join(appRoot, 'index.css').replaceAll('\\', '/')
  const source = appRoot.replaceAll('\\', '/')
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
  root: nativeRoot,
  // Keep Vite's cache in the one install folder (spec 009 FR-006).
  cacheDir: path.join(rootNodeModules, '.vite/mobile-web'),
  base: './',
  publicDir: path.join(appRoot, 'platforms/electron/public'),
  resolve: {
    // Research R4: the host's own suffix wins, so `host.native.ts` is chosen for `host`.
    extensions: ['.native.tsx', '.native.ts', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    alias: [
      { find: /^@app\//, replacement: `${appRoot.replaceAll('\\', '/')}/` },
      { find: /^@core$/, replacement: path.join(workspaceRoot, 'core/src/index.ts') },
      { find: /^@core\//, replacement: `${path.join(workspaceRoot, 'core/src').replaceAll('\\', '/')}/` },
      { find: /^pdfjs-dist$/, replacement: `${pdfjsLegacy}/pdf.mjs` },
      { find: /^pdfjs-dist\/build\/pdf\.worker\.min\.mjs(\?url)?$/, replacement: `${pdfjsLegacy}/pdf.worker.min.mjs$1` },
      { find: /^react(\/.*)?$/, replacement: `${path.join(rootNodeModules, 'react').replaceAll('\\', '/')}$1` },
      { find: /^react-dom(\/.*)?$/, replacement: `${path.join(rootNodeModules, 'react-dom').replaceAll('\\', '/')}$1` },
    ],
  },
  plugins: [scanDesktopUiForTailwind(), tailwindcss(), react()],
  build: {
    outDir: 'web-dist',
    emptyOutDir: true,
  },
})
