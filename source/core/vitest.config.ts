import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Spec 009: caches live in the one install folder at the repository root, never in a second node_modules here.
const rootNodeModules = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../node_modules')

// Unit tests for the platform-agnostic core. `node` env on purpose: SDK code must not need a DOM.
export default defineConfig({
  cacheDir: path.join(rootNodeModules, '.vite/core-tests'),
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
