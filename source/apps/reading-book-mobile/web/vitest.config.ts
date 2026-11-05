import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Mobile web tests (spec 008, US4): stores and bridge on node:sqlite, `node` environment. Aliases match vite.config.ts.
const workspaceRoot = path.resolve(__dirname, '../../..')

export default defineConfig({
  root: __dirname,
  // Spec 009: caches live in the one install folder at the repository root.
  cacheDir: path.join(workspaceRoot, '..', 'node_modules', '.vite/mobile-tests'),
  resolve: {
    alias: [
      { find: '@reading-book/config', replacement: path.join(workspaceRoot, 'core/src/config') },
      { find: '@reading-book/book-reader-sdk', replacement: path.join(workspaceRoot, 'core/src/index.ts') },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
