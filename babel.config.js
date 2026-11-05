// Babel for the Mobile host's Metro bundle only (spec 009 T015). Vite builds the Desktop and WebView UI and does not
// read this file (@vitejs/plugin-react runs without a Babel config file).
module.exports = function (api) {
  api.cache(true)

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          alias: {
            '^@/assets/(.*)$': './source/apps/reading-book-mobile/assets/\\1',
            '^@/(.*)$': './source/apps/reading-book-mobile/src/\\1',
          },
        },
      ],
    ],
  }
}
