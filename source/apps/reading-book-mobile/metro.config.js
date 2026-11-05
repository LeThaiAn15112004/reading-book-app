const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')
const { withUiMiddleware } = require('./scripts/ui-middleware.cjs')

// Monorepo watch folders and node_modules paths come from expo/metro-config (SDK 52+); do not set them here.
/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

config.server = {
  ...config.server,
  enhanceMiddleware: withUiMiddleware(path.join(__dirname, 'web', 'dist'), config.server?.enhanceMiddleware),
}

module.exports = config
