import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Mobile web tests (spec 008, US4): stores and bridge on node:sqlite, `node` environment. Aliases match vite.config.ts.
const workspaceRoot = path.resolve(__dirname, '../../..')

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: [
      { find: '@reading-book/config', replacement: path.join(workspaceRoot, 'packages/config') },
      { find: '@reading-book/book-reader-sdk', replacement: path.join(workspaceRoot, 'apps/book-reader-sdk/src/index.ts') },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
