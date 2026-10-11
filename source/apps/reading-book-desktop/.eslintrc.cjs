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
  },
  overrides: [
    {
      // Context modules co-locate a Provider with its `useX()` hook by convention; Fast Refresh
      // just does a full reload when one of them changes.
      files: ['**/*Context.tsx'],
      rules: { 'react-refresh/only-export-components': 'off' },
    },
  ],
}
