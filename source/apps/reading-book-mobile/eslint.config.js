// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");
const globals = require("globals");

module.exports = defineConfig([
  expoConfig,
  {
    // Node scripts (build, feasibility, Metro middleware): Node globals such as `Buffer`.
    files: ["scripts/**/*.{js,mjs,cjs}", "plugins/**/*.js", "*.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    // `@app/*` is the shared UI alias (tsconfig paths + Vite); this resolver does not read it (spec 009 T038).
    files: ["web/src/main.ts"],
    rules: { "import/no-unresolved": ["error", { ignore: ["^@app/"] }] },
  },
  {
    ignores: ["dist/*", "web/dist/**", "modules/*/ui-assets/**", "modules/*/android/build/**", "android/**", "ios/**", ".expo/**"],
  }
]);
