# Tasks: One Project for Desktop and Mobile

**Input**: Design documents from `specs/009-single-project-monorepo/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: No new test suites are requested. Every task ends with a **gate**: the existing checks named in the task
must pass before the task is committed (plan.md "Phase plan", FR-019). One task = one commit; a failing task is
reverted alone.

**Organization**: Grouped by user story (spec.md). The four phases the user asked for map as: plan Phase 1 →
Phase 2 (Foundational) + US1 + US2 + US3; plan Phase 2 + 3 → US4; plan Phase 4 → US5 + Polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

## Path conventions

Before US4 the old paths are used (`source/apps/…`). From US4 on, the new ones (`source/core`, `source/app`,
`source/app/platforms/{electron,native}`), per data-model.md "Path map". Commands run at the repository root once
T012 is done (contracts/root-commands.md).

**G-base** (gate used by most tasks): all type checks + lint + core tests (≥ 1016) + Desktop `vite build` + Mobile
`build:web` + Mobile tests (≥ 111) + `check:boundaries` (6/6) + `check:desktop-baseline` (25/25).

---

## Phase 1: Setup

**Purpose**: Record what must not change.

- [X] T001 Record the baseline in `specs/009-single-project-monorepo/quickstart.md` §Baseline: size of each `node_modules` with and without `**/android/.cxx` and `**/android/build` (research R8), `npm ls react react-dom typescript eslint` per workspace, G-base results, the asset list of Desktop `npx vite build` (`source/apps/reading-book-desktop/dist/assets`), and SHA-256 of the 30 files in `source/apps/reading-book-desktop/electron/persistence/migrations/`
- [X] T002 [P] Add the 30 migration SHA-256 values from T001 to `source/scripts/check-desktop-baseline.mjs` as a check "migrations byte-identical" (it must keep passing after T030 moves them)

---

## Phase 2: Foundational (plan Phase 1: React 19 and one manifest) ⚠️ blocks every story

**Purpose**: one React, one tool set, one manifest, nothing moved yet.

- [X] T003 Upgrade Desktop to React 19 in `source/apps/reading-book-desktop/package.json`: `react` and `react-dom` 19.2.3, `@types/react` and `@types/react-dom` ~19.2; `npm install` in `source/`
- [X] T004 Fix the React 19 type errors reported by `npm run typecheck` in `source/apps/reading-book-desktop/src/**` (`useRef()` without argument, global `JSX` → `React.JSX`, removed APIs; research R2); no behaviour change. Gate: Desktop `typecheck`, `lint`, `npx vite build`; spikes `spike:reader:toolbar`, `spike:session:roundtrip`, `spike:txt:store`, `spike:settings:reset`, `spike:pdf:annotations`, `spike:pdf:shape-store`, `spike:audio:store`, `spike:annotations:store`; `check:desktop-baseline` **Done 2026-11-05**: on the clean single install (T010) React 19 types needed 1 fix (`JSX.Element` → `React.JSX.Element`, `LibraryBrowseToolbar.tsx`); the first run reported 0 errors only because the old nested install still mixed type versions. Lint, `vite build`, `e2e:typecheck` pass; spikes pass except `spike:reader:toolbar` (known `transcript` assertion, same before spec 009)
- [X] T005 Ask the user whether to run Desktop E2E on the React 19 build (`npm run e2e` in `source/apps/reading-book-desktop`); record the result against the known failures of spec 008 in `specs/009-single-project-monorepo/quickstart.md` §Results **Done 2026-11-05** (user agreed): 72 passed / 4 failed / 8 skipped (before spec 009: 67–71 passed). Failures: `epub-toc-regression` E2E 7, `md-reader` E, `pdf-annotations` "EPUB highlights …" (all three fail the same way on the pre-009 code, spec 008 tasks), `pdf-typewriter` (passes when rerun alone: 2/2; environment, as recorded in spec 008)
- [X] T006 Unify TypeScript on ~6.0.3: set it in every manifest, fix deprecations reported for `source/apps/reading-book-desktop/tsconfig.json`, `tsconfig.node.json`, `source/apps/book-reader-sdk/tsconfig.json`, `tests/tsconfig.json`. Gate: G-base **Done 2026-11-05**: TS 6.0.3 needed `lib` ES2020 → ES2022 in the Desktop tsconfig (`Array#at`, previously typed by older `@types/node`) and 3 type-only fixes in `electron/` where the newer `@types/node` types a Worker `error` as `unknown` (approved in `source/scripts/desktop-main-changes.json`)
- [X] T007 Move Desktop to ESLint 9: replace `source/apps/reading-book-desktop/.eslintrc.cjs` by `eslint.config.js` (flat; `typescript-eslint` 8, `eslint-plugin-react-hooks` 5+, `eslint-plugin-react-refresh`), same rules, `--max-warnings 0`, `--report-unused-disable-directives`. Gate: Desktop `lint` with 0 warnings; G-base **Done 2026-11-05**: `eslint.config.mjs`, same rules; two rules new in the upgraded presets kept off to keep the rule set (`@typescript-eslint/no-unused-expressions`; `react-hooks/rules-of-hooks` in `e2e/`, where Playwright's `use` is not React's). Mobile lint: build output ignored, Node globals for scripts; 0 errors, 1 warning as before
- [X] T008 [P] Align `jszip` to ^3.10.2 in `source/apps/reading-book-desktop/package.json`. Gate: `spike:annotations:main`, Desktop `typecheck`
- [X] T009 Create the root `package.json` (repository root): union of the dependencies of `package.json` (root launcher), `source/package.json`, `source/apps/*/package.json`, `source/packages/config/package.json` with research R1 versions; `"main": "expo-router/entry"`; `overrides` from `source/package.json`; `expo.autolinking` search paths covering `source/apps/reading-book-mobile/modules`; scripts per contracts/root-commands.md pointing at the current folders (`dev` = Desktop only, `dev:mobile`, `dev:all`, `build`, `build:web`, `typecheck`, `lint`, `test`, `check`, `check:*`, `e2e*`, every `spike:*`, `android`); `postinstall` = `electron-rebuild -o better-sqlite3` from the Desktop folder **Done 2026-11-05**: 43 dependencies, 28 devDependencies, 93 scripts (`package.json`). Kept manifests (no dependencies, so npm installs nothing for them): Desktop (`name`/`main` that Electron reads; the name sets `userData`), Mobile (Expo `main`), SDK and config (linked with `file:` until US4 moves them, because spikes and Main import them by name)
- [X] T010 Delete `source/package.json`, `source/apps/*/package.json`, `source/packages/config/package.json`, every `package-lock.json` except the root one, and every `node_modules` except the root one; run `npm install` at the root. Keep import names `@reading-book/book-reader-sdk` and `@reading-book/config` working through the existing tsconfig `paths` and Vite aliases (no workspace links needed) **Done 2026-11-05**: one install at the root (1,580 packages). 6 files under `source/apps/reading-book-mobile/node_modules/react-native-{worklets,reanimated}/android/.gradle` could not be deleted: VS Code's Java extension holds them; they go when VS Code is closed (`clean:old-installs`, T020)
- [X] T011 Make each folder's tools find the root install: `source/apps/reading-book-desktop/vite.config.ts`, `tsconfig*.json`, `e2e/playwright.config.ts`, `source/apps/reading-book-mobile/web/vite.config.ts`, `web/vitest.config.ts`, `tsconfig.json`, `source/apps/book-reader-sdk/vitest.config.ts`, the spikes that resolve `node_modules` by path, `source/scripts/**`. Gate: G-base from the root scripts **Done 2026-11-05**: paths fixed in the Mobile web Vite config (+ `cacheDir` in the root install) and tsconfig, two spikes, the boundaries tests; R5 reads a fixed area list; the Desktop baseline runs root scripts and accepts listed Main changes; CI installs at the root
- [X] T012 Gate the foundation: at the root, `npm run check` passes; `find . -name node_modules -prune` shows only `./node_modules`; `npm ls react` shows one 19.2.3 **Done 2026-11-05**: `npm run check` passes at the root (typecheck ×6, lint, 1016 + 111 tests, `check:boundaries` 6/6, both builds); one `react` 19.2.3; Desktop baseline 26/26; spikes `session:roundtrip`, `txt:store`, `pdf:annotations`, `audio:migration`, `annotations:perf`, `annotations:main`, `settings:reset`, `transcription:store` pass from the root

**Checkpoint**: one install folder, React 19 on both hosts, every check from the root.

---

## Phase 3: User Story 1 - Start the desktop app from the repository root (P1) 🎯 MVP

**Goal**: `npm run dev` at the root starts Desktop only.

**Independent Test**: fresh clone → `npm install` → `npm run dev` opens the Desktop window; no Expo / Metro process.

- [X] T013 [US1] Make root `dev` run the Desktop dev server (Vite + Electron) with the Desktop folder as Vite root, and `dev:all` run Desktop and Mobile with `concurrently` in `package.json`; remove the old root launcher scripts **Done 2026-11-05**: in place since T009 (`dev` = Desktop only, `dev:all` = both)
- [X] T014 [US1] Check `npm run dev` at the root: window opens, a book opens, hot reload of a screen works, no Expo process; record in `specs/009-single-project-monorepo/quickstart.md` §Results (SC-001 Desktop) **Done 2026-11-05** (agent, hidden window `READMATE_E2E_HIDDEN`): Vite ready in 2–3 s, renderer `200`, Electron running after 8 s, no Expo / Metro process; rerun after T015–T017 the same. Hot reload of a screen not observable by the agent in hidden mode: left to the user

**Checkpoint**: US1 usable on its own.

---

## Phase 4: User Story 2 - Start the mobile app from the same root (P1)

**Goal**: `npx expo start` and `npm run dev:mobile` at the root start Mobile.

**Independent Test**: at the root, `npx expo start` → QR code → Expo Go opens the Readmate Library.

- [X] T015 [US2] Move `source/apps/reading-book-mobile/app.json`, `metro.config.js`, `babel.config.js`, `expo-env.d.ts` to the repository root; set the `expo-router` plugin `root` to `source/apps/reading-book-mobile/src/app`; plugin paths `./source/apps/reading-book-mobile/plugins/*.js` (research R5) **Done 2026-11-05**: `app.json`, `metro.config.js`, `babel.config.js` at the root; asset and plugin paths into the Mobile folder; Expo Router `root` = `./source/apps/reading-book-mobile/src/app`
- [X] T016 [US2] Rewrite `metro.config.js` for the root: `projectRoot` = repository root, `watchFolders` = `source/`, `blockList` for `**/dist/**`, `**/dist-electron/**`, `**/release/**`, `android/**`, `ios/**`, `**/node_modules/**/android/**`; keep the `/readmate-ui/` middleware (`source/apps/reading-book-mobile/scripts/ui-middleware.cjs`); delete `source/apps/reading-book-mobile/scripts/link-expo-root.mjs` and its `postinstall` **Done 2026-11-05**: `metro.config.js` at the root with `blockList` (root and Mobile `android/`, `ios/`, Desktop `dist*`/`release`, WebView `dist`, `ui-assets`, local-server build); `link-expo-root.mjs` was already removed in T011
- [X] T017 [US2] Make `dev:mobile` build the WebView UI once then run `expo start`, and `dev:web` watch it, in `package.json`; `.gitignore` at the root covers `/android`, `/ios`, `.expo/` **Done 2026-11-05**: `dev:mobile` = `build:web` + `expo start`, `android`/`ios` at the root; root `.gitignore` covers `/android`, `/ios`, `.expo/`, `expo-env.d.ts`. Expo writes a root `tsconfig.json`: kept, narrowed to the React Native host
- [ ] T018 [US2] Gate: `npx expo start` at the root shows the QR code and serves the UI (`/readmate-ui/index.html` answers 200); ask the user to open it in Expo Go and import a book (SC-007); `npx expo prebuild -p android --no-install` at the root writes `./android` with the short native build folder block (`plugins/with-short-native-build-dir.js`); record in `quickstart.md` §Results **Agent part done 2026-11-05**: `npm run dev:mobile` at the root → "Waiting on http://localhost:8081" in 69 s, `/readmate-ui/index.html` `200`, Android bundle of `expo-router/entry` built (1,384 modules); `npx expo prebuild -p android` at the root writes `./android` with the short-build-dir block and the loopback network config; autolinking finds `local-server`. **Waiting for the user**: open it in Expo Go and import a book (SC-007)

**Checkpoint**: US1 and US2 both work from the root.

---

## Phase 5: User Story 3 - One install folder for the whole repository (P2)

**Goal**: one `node_modules`, one lock file, smaller footprint.

**Independent Test**: quickstart.md §3.

- [ ] T019 [US3] Add `source/scripts/check-single-install.mjs`: fails if any `node_modules` (outside the root one), `package-lock.json` or `package.json` (outside `node_modules`, `android/`, `ios/`) exists besides the root ones; root script `check:single-install`, included in `check`
- [ ] T020 [P] [US3] Add `source/scripts/clean-old-installs.mjs` (FR-020): removes the old per-folder `node_modules` and lock files listed in data-model.md from an existing checkout, prints what it removed; root script `clean:old-installs`
- [ ] T021 [US3] Run `npm dedupe` at the root; measure `node_modules` as in T001 (without native build output); record in `quickstart.md` §Results; SC-004 needs ≤ 75 % of the baseline. If not met, list the 20 largest packages and which host needs each

**Checkpoint**: SC-002 and SC-004 measured.

---

## Phase 6: User Story 4 - One project, one place for each kind of code (P2)

**Goal**: the user's layout `source/core` + `source/app` (`components/`, `screens/`, `platforms/`), database logic in core,
platform adapters.

**Independent Test**: data-model.md path map holds; `check:boundaries` (with its negative tests), `check:platform-adapters`,
G-base all pass.

### Core move and driver ports (plan Phase 2)

- [ ] T022 [US4] Move `source/apps/book-reader-sdk/src` → `source/core/src` and `tests` → `source/core/tests` with `git mv`; move `source/packages/config/*` → `source/core/src/config/`; point the aliases `@reading-book/book-reader-sdk` and `@reading-book/config` (root `tsconfig.json`, both Vite configs, vitest config, Metro, `source/apps/reading-book-mobile/web/tsconfig.json`) at the new folders. Gate: G-base, core tests ≥ 1016
- [ ] T023 [US4] Remove the portable bundle (FR-012): delete `source/apps/book-reader-sdk/build.mjs`, `dist/`, `rolldown` dependency, the `dist`-only checks; create `tsconfig.core.json` at the root (`lib: ["ES2022"]`, `types: []`, `include: ["source/core/src"]`) and a core-tests tsconfig. Gate: `npm run typecheck`
- [ ] T024 [US4] Move `source/apps/book-reader-sdk/host-adapters` → `source/apps/reading-book-desktop/electron/host-adapters` (moves with the Desktop host in T047); update its imports in `electron/**`. Gate: Desktop `typecheck`, `spike:annotations:main`
- [ ] T025 [US4] Update `source/scripts/boundaries/*` for `source/core` (R1–R3, R5) and delete the now-empty `source/apps/book-reader-sdk` and `source/packages`. Gate: `check:boundaries` and its negative tests
- [ ] T026 [US4] Add the driver ports exactly as in contracts/sql-drivers.md to `source/core/src/db/driver.ts` (`SqlValue`, `Statement`, `SyncSqlDriver`, `AsyncSqlDriver`), exported from `source/core/src/index.ts`; unit tests on `node:sqlite` in `source/core/tests/db/driver.test.ts`
- [ ] T027 [US4] Implement `SyncSqlDriver` over `better-sqlite3` in `source/apps/reading-book-desktop/electron/persistence/db.ts` (same connection; `transaction(work, 'immediate')` = `BEGIN IMMEDIATE … COMMIT` with no `await`), without changing any store yet. Gate: G-base, `spike:session:roundtrip`
- [ ] T028 [P] [US4] Implement `AsyncSqlDriver` in `source/apps/reading-book-mobile/web/src/bridge/host-sql-driver.ts` over the host `sql.*` services. Gate: Mobile tests ≥ 111
- [ ] T029 [US4] Move the Desktop migrations byte-identical: `source/apps/reading-book-desktop/electron/persistence/migrations/*.sql` → `source/core/src/db/desktop/migrations/`; `migrate.ts` reads them from there (dev and packaged: copy them into `dist-electron` or bundle as text in `vite.config.ts`). Gate: T002 hashes, `spike:audio:migration`, `check:desktop-baseline` "30 migrations"
- [ ] T030 [P] [US4] Move the Mobile baseline `source/apps/reading-book-mobile/web/src/db/migrations/*` → `source/core/src/db/mobile/migrations/`; `web/src/db/migrate.ts` imports from there. Gate: Mobile tests
- [ ] T031 [US4] Move the pure migration planning (which files, which order, version check) into `source/core/src/db/migrations.ts`, used by both runners. Gate: G-base

### Stores: SQL and codecs into core, one store per task (research R3)

- [ ] T032 [US4] Library: statements and row codecs of `sqlite-library-store.ts` and `web/src/stores/library-store.ts` → `source/core/src/db/library/{statements,codec}.ts`; both stores run them through their driver, control flow and transactions unchanged. Gate: G-base, `spike:session:roundtrip`, `spike:annotations:main`, Mobile `stores.test.ts`, `contract-conformance.test.ts`
- [ ] T033 [US4] Overlay: same for `sqlite-overlay-store.ts` and `web/src/stores/overlay-store.ts` → `source/core/src/db/overlay/`. Gate: G-base, `spike:pdf:annotations`, `spike:pdf:embedded`, `spike:pdf:two-way`, `spike:pdf:shape-store`, `spike:annotations:main`, `spike:annotations:perf`, Mobile store tests
- [ ] T034 [US4] TXT: `sqlite-txt-store.ts` → `source/core/src/db/txt/`; `SqliteTxtStore.commit` keeps its own transaction. Gate: G-base, `spike:txt:main`, `spike:txt:store`
- [ ] T035 [US4] Audio: `sqlite-audio-store.ts` → `source/core/src/db/audio/`. Gate: G-base, `spike:audio:main`, `spike:audio:chapters`, `spike:audio:zip-import`
- [ ] T036 [US4] Transcript: `sqlite-transcript-store.ts` → `source/core/src/db/transcript/`; `commitWindow` keeps its transaction. Gate: G-base, `spike:transcription:main`
- [ ] T037 [US4] Remaining SQL in `electron/persistence/repositories/*` and `backfill-library-metadata.ts` → `source/core/src/db/`; retire `source/core/src/persistence/sql-notes.ts` (not production, spec 008 FR-023) and its test, or rebase it on the overlay codec. Gate: G-base

### `source/app` and platform adapters (plan Phase 3)

- [ ] T038 [US4] Move the UI with `git mv` per data-model.md: `source/apps/reading-book-desktop/src/screens` → `source/app/screens`; `src/{components,chrome,reader}` → `source/app/components/{…,chrome,reader}`; `src/{hooks,theme,styles,shortcuts,utils,bridge,assets,spikes}`, `main.tsx`, `App.tsx`, `index.css`, `vite-env.d.ts`, and `index.html` → `source/app/`; alias `@app/*` in root `tsconfig.json` and both Vite configs; Desktop Vite `root` = `source/app`; Mobile `web/src/main.ts` imports `@app/main`. Gate: G-base; Desktop `vite build` asset list equal to T001's except hashes
- [ ] T039 [US4] Create `tsconfig.electron.json` (`moduleSuffixes: [".electron", ""]`, `include` `source/app` + Desktop host) and `tsconfig.native.json` (`moduleSuffixes: [".native", ""]`, `include` `source/app` + Mobile host) extending the root `tsconfig.json`; `resolve.extensions` with the suffix first in both Vite configs (research R4); `typecheck` runs both
- [ ] T040 [US4] Add `source/scripts/check-platform-adapters.mjs` (contracts/platform-adapters.md rule 6) and the R12 lint rule (no suffixed import outside `source/app/platforms/`) in `eslint.config.js`; root script `check:platform-adapters` in `check`
- [ ] T041 [US4] Adapter `host`: `source/app/platforms/host.electron.ts` (`isMobileHost() = false`, every feature available) and `host.native.ts` (`true`, the first-release set of today's `src/platform/index.ts`); replace imports of `platform/index` in `source/app/**`; delete `source/app/platform/index.ts`. Gate: G-base, `spike:reader:toolbar`, `check:platform-adapters`
- [ ] T042 [US4] Adapter `longPress`: `longPress.electron.ts` (`{ onContextMenu }`) and `longPress.native.ts` (touch long press of today's `platform/long-press.ts`); replace imports; delete `source/app/platform/`. Gate: G-base
- [ ] T043 [US4] Adapter `api`: `api.electron.ts` returns the preload's `window.api`; `api.native.ts` builds the Mobile Bridge (`createBridge` from `source/apps/reading-book-mobile/web/src/bridge`) and returns it; `source/app/bridge/*` call `api` from `@app/platforms/api` instead of `window.api`; Mobile `web/src/main.ts` no longer injects `window.api`. Gate: G-base, R9 boundary rule, bundle grep: Desktop build has no `bridge/host-client`, WebView build has no `ipcRenderer`
- [ ] T044 [US4] Adapter `storage`: book bytes and cover URLs (`.electron`: IPC + `rb-cover://`; `.native`: local-server URLs with the token) out of `source/app/bridge/library.ts` and the Mobile bridge into `storage.electron.ts` / `storage.native.ts`. Gate: G-base, `spike:session:roundtrip`, Mobile `bridge.test.ts`
- [ ] T045 [US4] Adapter `window`: title bar / fullscreen / native theme calls of `source/app/chrome` (`.electron`) and system bars + safe areas of `web/src/bridge/system-bars.ts` (`.native`) into `window.electron.ts` / `window.native.ts`. Gate: G-base, Mobile `system-bars.test.ts`
- [ ] T046 [US4] Verify the platform split of the builds: grep `dist/` (Desktop renderer) for `.native` modules and the WebView build for `.electron` modules; both must be 0; record in `quickstart.md` §Results

### Hosts under `platforms/`

- [ ] T047 [US4] Move the Desktop host with `git mv`: `source/apps/reading-book-desktop/{electron,spikes,e2e,scripts,resources,assets}` → `source/app/platforms/electron/`; `electron-builder.json5` → repository root with updated paths (`files`, `extraResources`, `afterPack`); `vite.config.ts` → repository root (`vite-plugin-electron` entries `source/app/platforms/electron/main.ts`, `preload.ts`); every `spike:*`, `e2e*` root script path. Gate: G-base, `e2e:typecheck`, spikes `session:roundtrip`, `pdf:annotations`, `txt:main`, `audio:main`, `audio:migration`; `npm run dev` opens Desktop
- [ ] T048 [US4] Move the Mobile host with `git mv`: `source/apps/reading-book-mobile/src/host` → `source/app/platforms/native/host`, `src/app` → `native/routes` (Expo Router `root` updated), `web/src/{bridge,stores,db,feasibility,secure-context-shims.ts,main.ts}` → `native/` (`bridge/`, `stores/`, …), `web/tests` → `native/tests`, `web/index.html` → `native/index.html`, `web/vite.config.ts` → root `vite.native.config.ts`, `modules/local-server` → `native/modules/local-server`, `plugins` → `native/plugins`, `scripts` → `native/scripts`; update `app.json`, Metro, root `expo.autolinking` paths. Gate: Mobile `typecheck`, tests ≥ 111, `build:web`; `npx expo start` serves the UI; `npx expo prebuild -p android` + `cd android && ./gradlew :local-server:testDebugUnitTest` (13 pass)
- [ ] T049 [US4] Replace the import names `@reading-book/book-reader-sdk` / `@reading-book/config` by `@core/*` everywhere; remove the old aliases; delete the empty `source/apps`. Gate: G-base
- [ ] T050 [US4] Re-point every rule of `source/scripts/boundaries/*` per contracts/dependency-rules.md (R1–R3, R5–R9, R11, new R12; R4 retired) and update their negative tests in `boundaries.test.mjs`. Gate: `check:boundaries` passes and every negative test fails as designed (SC-006)

**Checkpoint**: only `source/core`, `source/app`, `source/scripts` under `source/`; all gates green.

---

## Phase 7: User Story 5 - Desktop and mobile users notice nothing (P1)

**Goal**: same behaviour, same data, desktop package without mobile code.

**Independent Test**: Desktop baseline + packaged app + Expo Go journey.

- [ ] T051 [US5] Packaging (research R6): `electron-builder.json5` `files` = `dist`, `dist-electron`, the typewriter fonts, `!node_modules/**` + allowlist of Main externals (`better-sqlite3`, `music-metadata`, `@huggingface/transformers`, `onnxruntime-node`, `sharp` and their runtime dependencies, resolved by a script from `npm ls --prod`)
- [ ] T052 [US5] Add `source/scripts/check-desktop-package.mjs`: lists the packaged `app.asar` and fails on `react-native`, `expo`, `platforms/native`; root `package` runs it after electron-builder (FR-017)
- [ ] T053 [US5] Run `npm run package` on Windows: installer builds, installs, starts, opens a copy of the pre-change library (SC-005); compare installer size with the last pre-009 build; record in `quickstart.md` §Results
- [ ] T054 [US5] Run `npm run check:desktop-baseline` at the end state (25/25 incl. the pre-change library and the migration hashes of T002); record in `quickstart.md` §Results
- [ ] T055 [US5] Ask the user to run the Expo Go journey (import, open each format, highlight, restart) and, with their agreement, Desktop E2E; record both against the pre-009 results in `quickstart.md` §Results (SC-007)
- [ ] T056 [US5] Build the Android APK from the root (`npm run android`, or `cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64 --no-parallel`); record in `quickstart.md` §Results and in `specs/008-shared-core-architecture/m5-results.md` (closes spec 008 T092 if it builds)

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T057 Rewrite `.github/workflows/ci.yml`: no `working-directory: source`, `cache-dependency-path: package-lock.json`, `npm ci` at the root, then `npm run check` (+ `check:single-install`) (FR-018)
- [ ] T058 [P] Update `CLAUDE.md`: repository structure, commands, dependency rule, path aliases, Mobile section, every `source/apps/…` path (FR-021)
- [ ] T059 [P] Update `README.md` (root) with quickstart.md §1–§2, and turn `source/apps/reading-book-mobile/README.md` / `book-reader-sdk/README.md` content into sections of the root README or `docs/` (their folders no longer exist)
- [ ] T060 [P] Update `docs/software/SDS.md` §2.7, §2.11, §2.12 and changelog 1.27; `docs/implementation_plan/mobile_webview.md` feature map paths
- [ ] T061 [P] Update path references in `specs/008-shared-core-architecture/{plan.md,contracts/*.md,quickstart.md}` with a note that spec 009 moved them (history sections stay as written)
- [ ] T062 Final run of quickstart.md §1–§5 from a fresh clone; fill §Results with SC-001 … SC-008; report to the user

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T012)** blocks everything.
- **US1 (T013–T014)** and **US2 (T015–T018)** after Foundational; independent of each other.
- **US3 (T019–T021)** after Foundational; T021's size is final only after US4 (re-measure in T062).
- **US4 (T022–T050)** after US1 + US2 (their commands are gates for the moves). Inside: T022–T025 → T026–T031 →
  T032–T037 (one at a time) → T038 → T039–T040 → T041–T045 (one at a time) → T046 → T047 → T048 → T049 → T050.
- **US5 (T051–T056)** after US4.
- **Polish (T057–T062)** after US5; T058–T061 parallel.

## Parallel Opportunities

- T002 with T003; T008 with T006/T007 (different manifests once T003 is in).
- T020 with T019.
- T028 with T027; T030 with T029.
- T058, T059, T060, T061.

## Parallel Example: User Story 4

```text
Task: "T027 Implement SyncSqlDriver in .../electron/persistence/db.ts"
Task: "T028 Implement AsyncSqlDriver in .../web/src/bridge/host-sql-driver.ts"
```

## Implementation Strategy

### MVP

Setup + Foundational + US1 + US2 (T001–T018): one install, React 19, `npm run dev` and `npx expo start` at the root.
This already gives the user what they need day to day, with no source file moved.

### Incremental delivery

1. MVP (T001–T018) → stop and let the user work.
2. US3 (T019–T021): measured footprint, clean-up script.
3. US4 (T022–T050): the user's layout, in small commits; each leaves both apps running.
4. US5 + Polish (T051–T062): packaging, CI, docs, final results.
