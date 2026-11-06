// ESLint 9 flat config (spec 009 T007): the rules of the former `.eslintrc.cjs`, unchanged.
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

function windowApiRestrictions() {
  const message = 'window.api is used only in source/app/platforms/api.electron.ts; import `api` from the platform adapter instead (spec 008 R9, spec 009 T043).'
  return ['window', 'globalThis', 'self'].flatMap((object) => [
    { selector: `MemberExpression[object.name='${object}'][property.name='api']`, message },
    { selector: `MemberExpression[object.name='${object}'][computed=true][property.value='api']`, message },
  ])
}

export default tseslint.config(
  // Same scope as the former `eslint . --ext ts,tsx`: TypeScript files only.
  {
    ignores: [
      '**/dist', '**/dist-electron', '**/release', '**/playwright-report', '**/test-results', '**/node_modules',
      '**/*.js', '**/*.mjs', '**/*.cjs',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.es2020 },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      // The two rules of `plugin:react-hooks/recommended` in eslint-plugin-react-hooks 4 (the newer presets add the
      // React Compiler rules, which this code base has not adopted).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // `_name` marks an intentionally unused binding (rest-omit, interface-mandated parameter).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // New in typescript-eslint 8's `recommended`, not in 7's: kept off so the rule set stays the one before T007
      // (the code uses `(e.preventDefault(), move(1))` style key handlers on purpose).
      '@typescript-eslint/no-unused-expressions': 'off',
      // R9 (spec 008): only the `api` platform adapter touches window.api, so Mobile can supply the same API behind the same seam.
      'no-restricted-syntax': ['error', ...windowApiRestrictions()],
    },
  },
  {
    // Playwright fixtures are not React: their `use` callback is not React 19's `use` hook (react-hooks 5 reads it so).
    files: ['**/e2e/**'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
  {
    // R12 (spec 009): UI code imports a platform concern without its suffix; Vite and TypeScript pick the host's file.
    files: ['source/**/*.{ts,tsx}'],
    ignores: ['source/app/platforms/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/*.electron', '**/*.electron.*', '**/*.native', '**/*.native.*'],
              message: 'R12: import the platform concern without its .electron / .native suffix (source/app/platforms).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['source/app/platforms/api.electron.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Context modules co-locate a Provider with its `useX()` hook by convention; Fast Refresh
    // just does a full reload when one of them changes.
    files: ['**/*Context.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
)
