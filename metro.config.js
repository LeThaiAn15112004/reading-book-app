// Metro for the Mobile host, run from the repository root (`npx expo start`, spec 009 T016, research R5).
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const mobileDir = path.join(__dirname, 'source', 'apps', 'reading-book-mobile')
const { withUiMiddleware } = require(path.join(mobileDir, 'scripts', 'ui-middleware.cjs'))

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

// Only the React Native host is bundled by Metro; the shared UI is built by Vite for the WebView. Never crawl build
// output, generated native projects or the Desktop host.
const escape = (p) => p.replace(/[\\/]/g, '[\\\\/]').replace(/\./g, '\\.')
const blocked = [
  path.join(__dirname, 'android'),
  path.join(__dirname, 'ios'),
  path.join(__dirname, 'source', 'apps', 'reading-book-desktop', 'dist'),
  path.join(__dirname, 'source', 'apps', 'reading-book-desktop', 'dist-electron'),
  path.join(__dirname, 'source', 'apps', 'reading-book-desktop', 'release'),
  path.join(mobileDir, 'web', 'dist'),
  path.join(mobileDir, 'android'),
  path.join(mobileDir, 'modules', 'local-server', 'ui-assets'),
  path.join(mobileDir, 'modules', 'local-server', 'android', 'build'),
].map((p) => new RegExp(`^${escape(p)}([\\\\/].*)?$`))
config.resolver.blockList = [...[config.resolver.blockList ?? []].flat(), ...blocked]

// Expo Go only: serve the built WebView UI at /readmate-ui (spec 008, research R11).
config.server = {
  ...config.server,
  enhanceMiddleware: withUiMiddleware(path.join(mobileDir, 'web', 'dist'), config.server?.enhanceMiddleware),
}

module.exports = config
