// Expo host — TEMPLATE. Lets Metro bundle the SDK from a folder OUTSIDE the app's project root.
// Place in apps/reading-book-mobile/metro.config.js and adjust SDK_DIR to the relative location.
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const SDK_DIR = path.resolve(__dirname, '../book-reader-sdk')

const config = getDefaultConfig(__dirname)

// 1. Metro only watches the project root by default.
config.watchFolders = [...(config.watchFolders ?? []), SDK_DIR]

// 2. Map the import name to the folder; Metro reads its package.json (`main` → dist/index.cjs).
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@reading-book/book-reader-sdk': SDK_DIR,
}

// 3. The bundle is self-contained, so there is nothing to resolve from the SDK's own
//    node_modules — but make sure `.cjs` / `.mjs` are recognized source extensions.
for (const ext of ['cjs', 'mjs']) {
  if (!config.resolver.sourceExts.includes(ext)) config.resolver.sourceExts.push(ext)
}

module.exports = config
