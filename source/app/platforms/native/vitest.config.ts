import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Mobile web tests (spec 008, US4): stores and bridge on node:sqlite, `node` environment. Aliases match vite.config.ts.
const workspaceRoot = path.resolve(__dirname, '../../..')

export default defineConfig({
  root: __dirname,
  // Spec 009: caches live in the one install folder at the repository root.
  cacheDir: path.join(workspaceRoot, '..', 'node_modules', '.vite/mobile-tests'),
  resolve: {
    // Same adapter resolution as the WebView build (research R4).
    extensions: ['.native.tsx', '.native.ts', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    alias: [
      { find: /^@app\//, replacement: `${path.join(workspaceRoot, 'app').replaceAll('\\', '/')}/` },
      { find: /^@core$/, replacement: path.join(workspaceRoot, 'core/src/index.ts') },
      { find: /^@core\//, replacement: `${path.join(workspaceRoot, 'core/src').replaceAll('\\', '/')}/` },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
