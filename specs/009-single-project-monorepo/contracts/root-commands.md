# Contract: Root Commands

Every command a developer runs is a script of the root `package.json`, run at the repository root (FR-004). Final
state after Phase 4; Phase 1 introduces the first rows.

## Start

| Command | Does | Replaces |
|---|---|---|
| `npm install` | Installs everything once; `postinstall` rebuilds `better-sqlite3` for Electron | `npm install` in `source/` and in each app |
| `npm run dev` | Desktop: Vite + Electron dev server, **only** Desktop (FR-001) | root `npm run dev` (both), `cd reading-book-desktop && npm run dev` |
| `npx expo start` / `npm run dev:mobile` | Mobile: builds the WebView UI once, then Expo's dev server (FR-002) | `cd reading-book-mobile && npm start` |
| `npm run dev:all` | Both together (FR-003) | today's root `npm run dev` |
| `npm run dev:web` | WebView UI build in watch mode (with `dev:mobile`) | Mobile `dev:web` |

## Build and package

| Command | Does | Replaces |
|---|---|---|
| `npm run build` | Desktop renderer + Main + Preload (`vite build`) | `npx vite build` in Desktop |
| `npm run package` | `build` + electron-builder + `check:desktop-package` | Desktop `npm run build` |
| `npm run build:web` | Mobile WebView UI → `dist-native/` + local-server assets | Mobile `build:web` |
| `npm run android` | `expo run:android` (debug, local server) | Mobile `android` |

## Checks

| Command | Does |
|---|---|
| `npm run typecheck` | `tsc -p` for `tsconfig.core.json`, `tsconfig.electron.json`, `tsconfig.native.json`, core tests, E2E |
| `npm run lint` | ESLint 9, one flat config, `--max-warnings 0` |
| `npm test` | vitest: core tests + WebView tests |
| `npm run check:boundaries` | Dependency rules (contracts/dependency-rules.md) + negative tests |
| `npm run check:platform-adapters` | Every `.electron.ts` has a `.native.ts` twin with the same exports, and the reverse |
| `npm run check:desktop-baseline` | Spec 008 baseline (checks, `electron` sources unchanged in content, migrations, library copy) |
| `npm run check:desktop-package` | The packaged asar contains no `react-native`, `expo` or `platforms/native` |
| `npm run check` | `typecheck` + `lint` + `test` + `check:boundaries` + `check:platform-adapters` + `build` + `build:web` (CI runs this) |

## Desktop tooling kept

`npm run e2e`, `e2e:only`, `e2e:typecheck` (manual, user's agreement), every `spike:*` with its current name, and
Desktop's `scripts/*` helpers. Names stay; paths inside them change.

## Retired

| Old | Use instead |
|---|---|
| `npm run dev` doing both apps | `npm run dev:all` |
| SDK `npm run build`, `verify` | gone (no `dist/`, FR-012); `npm run check` |
| `npm --prefix …` and `cd source/apps/…` before any command | the root script |
| Mobile `postinstall` (`link-expo-root.mjs`) | not needed: Expo is no longer nested |
