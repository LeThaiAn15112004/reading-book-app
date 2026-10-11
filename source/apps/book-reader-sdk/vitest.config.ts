import { defineConfig } from 'vitest/config'

// Unit tests for the platform-agnostic core. `node` env on purpose: SDK code must not need a DOM.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
