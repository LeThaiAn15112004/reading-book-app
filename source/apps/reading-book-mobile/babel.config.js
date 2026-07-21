module.exports = function (api) {
  api.cache(true)

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          alias: {
            '^@reading-book/shared$': '../../packages/shared',
            '^@reading-book/shared/(.*)$': '../../packages/shared/\1',
            '^@/assets/(.*)$': './assets/\1',
            '^@/(.*)$': './src/\1',
          },
        },
      ],
    ],
  }
}