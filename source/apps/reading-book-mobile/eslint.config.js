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
    ignores: ["dist/*", "web/dist/**", "modules/*/ui-assets/**", "modules/*/android/build/**", "android/**", "ios/**", ".expo/**"],
  }
]);
