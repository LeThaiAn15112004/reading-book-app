# Research: One Project for Desktop and Mobile (spec 009)

**Date**: 2026-11-05. Facts measured in the repository on that date unless a source is linked.

## R1. Version conflicts that block one install folder

**Finding** (manifests of desktop, mobile, SDK):

| Package | Desktop | Mobile | SDK | Resolution |
|---|---|---|---|---|
| `react`, `react-dom` | ^18.2.0 | 19.2.3 | — | **19.2.3** everywhere (React Native 0.86 requires 19.2) |
| `@types/react`, `@types/react-dom` | ^18.2 | ~19.2.2 | — | ~19.2 |
| `typescript` | ^5.2.2 | ~6.0.3 | ^5.9.3 | **~6.0.3** (Expo SDK 57 template); fix the deprecations it reports in Desktop / core tsconfigs |
| `eslint` | ^8.57 (`.eslintrc.cjs`) | ^9 (flat config) | — | **9**, one flat `eslint.config.js`; `@typescript-eslint/*` 7 → `typescript-eslint` 8 (7 does not support ESLint 9 or TS 6); `eslint-plugin-react-hooks` 4 → 5+ |
| `jszip` | ^3.10.1 | ^3.10.2 | — | ^3.10.2 |

Everything else is either used by one side only or already the same range.

**Decision**: one manifest with the right-hand column. **Rationale**: these are the only packages that force a second
copy today. **Alternatives**: keep Desktop on React 18 with npm `overrides` per path: rejected, npm cannot install two
React majors for two parts of one package without a second install folder, which FR-006 forbids.

## R2. React 19 on the Desktop UI

**Risk points** (React 19 upgrade guide, react.dev/blog/2024/04/25/react-19-upgrade-guide):
`useRef()` needs an argument; the global `JSX` namespace moved to `React.JSX`; `ReactDOM.render` / `findDOMNode` /
string refs / `defaultProps` on function components / legacy context removed; `ref` is a prop (`forwardRef` still
works); `element.ref` access warns. Desktop dependencies: `react-router-dom` 7, `react-markdown` 10, `react-colorful`
5.6+, `zustand` 5 support React 19.

**Decision**: upgrade in Phase 1 as its own step, *before* any file moves, so a regression is attributable. Fix by
`npm run typecheck` errors first (most are `useRef()` and `JSX`), then lint, then the spikes that use the real renderer
stores, then the Desktop E2E suite (with the user's agreement, R7 of spec 008). **Alternatives**: upgrade after the
moves: rejected, two large changes at once would hide the cause of a failure.

## R3. Desktop SQLite stores are synchronous; Mobile's are asynchronous

**Finding**: 12 Main files use `better-sqlite3`; 18 `transaction(` / `BEGIN IMMEDIATE` sites. The annotation import
(`CLAUDE.md`, spec 006) *requires* a synchronous `BEGIN IMMEDIATE … COMMIT` with no `await` inside, because the
connection is shared and another handler's writes would land in the transaction. Mobile's stores run on an
asynchronous host driver (`web/src/bridge/host-sql-driver.ts`) with a write queue.

**Decision**: the core owns the database **logic as data and pure functions**, not execution:
- `core/src/db/`: schema and migrations of each app's database (Desktop `001`–`030` unchanged; Mobile baseline),
  statement builders (`{ sql, params }`), row ⇄ domain codecs, validation, and planning (what to write), all pure.
- Two driver ports in core: `SyncSqlDriver` (`run`, `all`, `get`, `transaction(fn)` — synchronous) and
  `AsyncSqlDriver` (the existing Mobile shape plus `transaction(statements[])`).
- `platforms/` holds the executors: Desktop binds the sync port to `better-sqlite3`; Mobile binds the async port to
  the host. Each store keeps its own control flow (sync or async) and calls core for SQL and mapping.

**Rationale**: moving SQL and mapping into core removes the duplicated logic (spec 008 OD-2) without changing how
Desktop transactions behave. **Alternatives**: (a) one async port for both: rejected, breaks the synchronous import
transaction and every synchronous IPC handler; (b) one sync port for both: impossible over `postMessage`;
(c) leave stores where they are: contradicts the user's layout (spec 009 Clarifications).

**Order**: one store at a time (library, overlay, txt, audio, transcript), each behind its existing spikes. Moving the
code without changing behaviour first (Phase 2a), extracting SQL/codecs second (Phase 2b).

## R4. Choosing `.electron.ts` / `.native.ts` at build time

**Finding**: Metro resolves `.native.ts`, but the mobile UI is built by Vite (WebView), so Metro never sees it.

**Decision**:
- **Vite**: `resolve.extensions` puts the platform suffix first: Desktop renderer
  `['.electron.tsx', '.electron.ts', '.tsx', '.ts', …]`, Mobile web build `['.native.tsx', '.native.ts', '.tsx', '.ts', …]`.
- **TypeScript**: `compilerOptions.moduleSuffixes` (TS 4.7+): `tsconfig.electron.json` with `[".electron", ""]`,
  `tsconfig.native.json` with `[".native", ""]`, both extending the root `tsconfig.json`. Both are type-checked, so a
  missing or mismatched adapter fails `typecheck`.
- **Contract**: every concern has exactly two files with the same exports; a check script compares their export names
  (`contracts/platform-adapters.md`).
- Screens import `platforms/storage`, never a suffixed file (lint rule).

**Alternatives**: a runtime `if (isMobileHost())` in one file: rejected, it bundles both platforms' code into each
build (FR-017). Path aliases per build: works but hides the pairing; suffixes make the pair visible.

## R5. Expo from the repository root

**Finding** (docs.expo.dev v57): `npx expo start` reads `app.json` and `package.json` `main` in the current folder.
Expo Router finds routes in `app/` or `src/app/` by default; another folder needs the `expo-router` plugin `root`
option. Metro's project root is the repository root, so `watchFolders` must cover `source/` and `blockList` must
exclude Desktop build output (`dist`, `dist-electron`, `release`), `android/`, `ios/`.

**Decision**: root `app.json` (moved from Mobile), `package.json` `"main": "expo-router/entry"`, routes in
`source/app/platforms/native/routes/` via the plugin's `root`, `metro.config.js` and `babel.config.js` at the root.
`npm run dev` stays Desktop (FR-001) because it is a different script; `npx expo start` does not read scripts.
Prebuild writes `android/` / `ios/` at the root (git-ignored). The short native build folder plugin (spec 008)
carries over.

**Alternative**: keep the Expo project in a subfolder and proxy the command: rejected, FR-002 wants `npx expo start` at
the root.

## R6. One manifest vs. what the desktop package may contain

**Finding**: electron-builder packages the app's `dependencies` (`node_modules`) beside the Vite output. With one
manifest, Expo and React Native would be "dependencies" too, and would land in the desktop installer (FR-017).

**Decision**: every runtime library is bundled by Vite into `dist/` and `dist-electron/` except Main's externals
(`better-sqlite3`, `music-metadata` and their dependencies, `onnxruntime-node` / `@huggingface/transformers` if
external). `electron-builder.json5` gets `"files": [...]` with `!node_modules/**` and an explicit allowlist of those
externals, and a packaging check lists the asar and fails if `react-native`, `expo` or anything under
`source/app/platforms/native` is inside. **Alternative**: two-package.json structure (`directories.app`): rejected, it
reintroduces a second manifest.

## R7. Native module ABI in one install

**Finding**: `better-sqlite3` is rebuilt for Electron's ABI (`@electron/rebuild`); the spikes that need it already
re-launch with `ELECTRON_RUN_AS_NODE`. Core and Mobile tests use `node:sqlite`, not `better-sqlite3`. Expo native
modules are compiled by Gradle / Xcode, not by npm.

**Decision**: a root `postinstall` runs `electron-rebuild -o better-sqlite3` (as Desktop does today) and the Expo
`link-expo-root` step is dropped (Expo is no longer nested). No conflict.

## R8. Disk footprint (SC-004)

**Baseline** (2026-11-05): 11 MB + 950 MB + 480 MB + 1.6 GB (includes Android native build output under
`node_modules/*/android/.cxx` and `build`) + 0 = ~3.0 GB. **Measurement rule**: `du -sh node_modules` after
`npm ci` on a clean tree, excluding `**/android/.cxx`, `**/android/build` on both sides; recorded in `quickstart.md`.

## R9. No constitution

`.specify/memory/constitution.md` is the unfilled template. The gates used are spec 008's rules: Desktop unchanged
(baseline script), dependency rules R1–R11 (`check:boundaries`), Desktop E2E only with the user's agreement.
