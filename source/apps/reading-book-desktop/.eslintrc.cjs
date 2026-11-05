function windowApiRestrictions() {
  const message = 'window.api is used only in src/bridge/*; import the bridge wrapper instead (spec 008, R9).'
  return ['window', 'globalThis', 'self'].flatMap((object) => [
    { selector: `MemberExpression[object.name='${object}'][property.name='api']`, message },
    { selector: `MemberExpression[object.name='${object}'][computed=true][property.value='api']`, message },
  ])
}

module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    // `_name` marks an intentionally unused binding (rest-omit, interface-mandated parameter).
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
    ],
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // R9 (spec 008): only src/bridge touches window.api, so Mobile can supply the same API behind the same seam.
    'no-restricted-syntax': ['error', ...windowApiRestrictions()],
  },
  overrides: [
    {
      files: ['src/bridge/**'],
      rules: { 'no-restricted-syntax': 'off' },
    },
    {
      // Context modules co-locate a Provider with its `useX()` hook by convention; Fast Refresh
      // just does a full reload when one of them changes.
      files: ['**/*Context.tsx'],
      rules: { 'react-refresh/only-export-components': 'off' },
    },
  ],
}
