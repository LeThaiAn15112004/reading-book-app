# Implementation Plan: One Project for Desktop and Mobile

**Branch**: `anle-dev` (no feature branch) | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-single-project-monorepo/spec.md`

## Summary

Turn the three npm workspaces (`apps/book-reader-sdk`, `apps/reading-book-desktop`, `apps/reading-book-mobile`) and
`packages/config` into **one project at the repository root**: one `package.json`, one `package-lock.json`, one
`node_modules`, React 19 on both hosts, and the user's layout `source/core` + `source/app` (`components/`, `screens/`,
`platforms/`). `npm run dev` at the root starts Desktop; `npx expo start` at the root starts Mobile. Spec 008's
architecture is kept (one UI, Mobile in a WebView, core free of platform code).

Four phases, as the user asked, each made of small steps; **every step ends with a gate** (type check, build, tests,
dependency rules) and a commit, so a failing step is reverted alone (FR-019, SC-008):

1. **Root project + React 19** (no file moves).
2. **SQLite driver ports + core move** (`book-reader-sdk` → `source/core`, database logic into core).
3. **`source/app` + platform adapters** (`.electron.ts` / `.native.ts`; hosts under `platforms/`).
4. **Root build / scripts / CI + final verification**.

## Technical Context

**Language/Version**: TypeScript ~6.0.3 everywhere (R1); Node 22 (CI), Electron 39, React 19.2.3, React Native 0.86.3, Expo SDK 57
**Primary Dependencies**: Vite 8 (Desktop renderer + Main, Mobile WebView build), vite-plugin-electron, electron-builder 26, Expo / Metro, zustand 5, pdf.js 5.4.624, epub.js
**Storage**: Desktop `better-sqlite3` (synchronous, migrations 001–030, unchanged); Mobile `expo-sqlite` through host services (asynchronous, own baseline). Logic for both moves into `source/core/src/db` (R3)
**Testing**: vitest (core `tests/`, Mobile WebView tests), `node --test` (boundaries), Desktop spikes, Kotlin unit tests (local server), Desktop baseline script, Playwright E2E (manual, user's agreement only)
**Target Platform**: Windows / macOS / Linux desktop (Electron); Android (Expo Go + native build); iOS later (spec 008 M6)
**Project Type**: Single project with two hosts (desktop app + mobile app) sharing one UI and one core
**Performance Goals**: No regression of Desktop startup or reader performance (Desktop baseline + E2E); install footprint ≥ 25 % smaller than 3.0 GB (SC-004)
**Constraints**: Desktop users notice nothing (FR-015); stored data and migrations unchanged; the synchronous annotation-import transaction stays synchronous (R3); desktop package contains no mobile code (FR-017); Windows path length (spec 008 M5)
**Scale/Scope**: ~370 UI files, ~24 k lines in `electron/`, ~270 core files, ~60 Mobile files, 69 Desktop scripts, 22 spikes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template (no ratified principles). Gates used instead (spec 008):

| Gate | How it is checked | Before design | After design |
|---|---|---|---|
| G1 Desktop unchanged | `check-desktop-baseline` (25 checks incl. the pre-change library) after every step | Pass (2026-11-05) | Kept as the gate of every step |
| G2 Core platform-independent (R1–R11) | `check:boundaries` + its negative tests | Pass (6/6) | Rules re-pointed to `source/core`, `source/app`, `source/app/platforms/*` (contracts/dependency-rules.md) |
| G3 No copied code between hosts | SC-005 scan of spec 008 | Pass (0 copies) | Unchanged |
| G4 E2E only with the user's agreement | Ask before running | — | Planned after Phase 1 and at the end |

No violation; Complexity Tracking lists the deliberate costs.

## Project Structure

### Documentation (this feature)

```text
specs/009-single-project-monorepo/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R9
├── data-model.md        # project artefacts and how they map (old path → new path)
├── quickstart.md        # how to install, run and verify from the root
├── contracts/
│   ├── root-commands.md     # every root script, and old command → new command
│   ├── platform-adapters.md # .electron.ts / .native.ts rules and the concern list
│   ├── sql-drivers.md       # SyncSqlDriver / AsyncSqlDriver and what core may contain
│   └── dependency-rules.md  # R1–R11 re-pointed to the new folders
└── checklists/requirements.md
```

### Source Code (repository root, after Phase 4)

```text
reading-book-app/
├── package.json            # the one manifest (all deps, all scripts, "main": "expo-router/entry")
├── package-lock.json       # the one lock file
├── node_modules/           # the one install folder
├── app.json, metro.config.js, babel.config.js, eas/expo files     # Expo at the root (R5)
├── tsconfig.json           # shared options + aliases @core/* → source/core/src, @app/* → source/app
├── tsconfig.electron.json  # moduleSuffixes [".electron", ""] + Main / Preload
├── tsconfig.native.json    # moduleSuffixes [".native", ""] + RN host + WebView entry
├── tsconfig.core.json      # core only: lib ES2022, types [] (R1)
├── vite.config.ts          # Desktop renderer + Main + Preload (from the Desktop folder)
├── vite.native.config.ts   # Mobile WebView UI build (from mobile web/vite.config.ts)
├── vitest.config.ts        # core tests + WebView tests (projects)
├── eslint.config.js        # one flat config (ESLint 9)
├── electron-builder.json5  # files allowlist (R6)
├── android/ ios/           # generated by prebuild, git-ignored
├── docs/  specs/
└── source/
    ├── core/
    │   ├── src/            # today's book-reader-sdk/src + packages/config + db/ (schema, migrations,
    │   │                   #   statements, codecs, driver ports) + host-adapters/ (Node-only, see note)
    │   └── tests/          # today's book-reader-sdk/tests (incl. contracts/)
    ├── app/
    │   ├── components/     # today's src/components + chrome/ + reader/ (renderers, toolbars)
    │   ├── screens/        # today's src/screens
    │   ├── hooks/ theme/ styles/ shortcuts/ utils/   # the rest of today's src/ (kept as folders)
    │   ├── bridge/         # today's src/bridge: typed wrappers, call `api` from platforms/api
    │   ├── main.tsx  App.tsx  index.css  index.html
    │   └── platforms/
    │       ├── api.electron.ts      api.native.ts       # window.api: preload's / the Mobile Bridge
    │       ├── storage.electron.ts  storage.native.ts   # (contracts/platform-adapters.md)
    │       ├── window.electron.ts   window.native.ts
    │       ├── host.electron.ts     host.native.ts      # isMobileHost / feature availability
    │       ├── electron/   # Desktop host: main.ts, preload.ts, ipc/, persistence/ (sync executors),
    │       │               #   adapters/, pdf-sync/, …, spikes/, e2e/, resources/, assets/, scripts/
    │       └── native/     # Mobile host: routes/ (Expo Router), host/ (services, expo drivers),
    │                       #   bridge/ + stores/ (WebView side, async executors), modules/local-server,
    │                       #   plugins/, scripts/
    └── scripts/            # boundaries/, check-desktop-baseline.mjs, check-platform-adapters.mjs
```

**Structure Decision**: the user's layout (spec Clarifications 2026-11-05). Folders of today's `src/` that the user's
tree does not name (`hooks/`, `theme/`, `styles/`, `shortcuts/`, `utils/`, `bridge/`) stay as siblings of
`components/` and `screens/` inside `source/app`; `reader/` and `chrome/` go under `components/`.
`book-reader-sdk/host-adapters` (cloud clients, translation engine: Node-only, imported by Main) is **not** core: it
goes to `source/app/platforms/electron/host-adapters/` (R11 of spec 008 already forbids Mobile to import it).

## Phase plan

Every step: make the change → run its gate → commit (`git revert` restores the previous step). "Base gate" below is:

```text
G-base = typecheck (all tsconfigs)  +  lint  +  core tests  +  Desktop renderer/Main build (npx vite build)
         +  Mobile WebView build (build:web)  +  Mobile tests  +  check:boundaries  +  check:desktop-baseline
```

Before Phase 1 the commands are run in their current folders; from Phase 1.3 on, from the root
(`contracts/root-commands.md`).

### Phase 1 — Root project and React 19 (no source file moves)

| Step | Change | Gate |
|---|---|---|
| 1.1 | Record the baseline: `du` of every `node_modules` (R8), G-base results, `npm ls react` | Saved in `quickstart.md` §Baseline |
| 1.2 | **React 19 on Desktop** inside today's layout: `react`/`react-dom` 19.2.3, `@types/react*` 19.2; fix `useRef()` / `JSX` / removed APIs reported by `tsc` | Desktop `typecheck`, `lint`, `npx vite build`; spikes `reader:toolbar`, `session:roundtrip`, `txt:store`, `settings:reset`, `pdf:annotations`, `pdf:shape-store`, `audio:store`, `annotations:store`; Desktop baseline; **ask the user to run Desktop E2E** |
| 1.3 | **Unify tool versions**: TypeScript ~6.0.3 (fix deprecations in Desktop/core tsconfigs), ESLint 9 flat config for Desktop (`typescript-eslint` 8, `react-hooks` 5), `jszip` ^3.10.2 | Same as 1.2 minus E2E; Mobile `lint`, `typecheck` |
| 1.4 | **One manifest**: merge the four `package.json` into the root one (deps union with R1 versions; scripts namespaced, see root-commands.md); delete per-folder manifests and lock files; `npm install` at the root; root `postinstall` = `electron-rebuild -o better-sqlite3`; per-folder `tsconfig`/`vite` configs keep working through relative paths | `ls` shows 1 `node_modules` + 1 lock (SC-002); G-base from the root; `npm run dev` opens Desktop; Mobile `build:web` + Expo Go start from the Mobile folder still works |
| 1.5 | **Expo at the root**: move `app.json`, `metro.config.js`, `babel.config.js`, Expo entry to the root; Expo Router `root` → today's Mobile `src/app`; Metro `watchFolders` / `blockList` (R5); drop `link-expo-root.mjs` | `npx expo start` at the root shows the QR code and Expo Go opens the Library (user check, SC-007 partial); `npx expo prebuild -p android` at the root; `npm run dev` still Desktop |

**Phase 1 exit**: one install, React 19 everywhere, both start commands at the root, nothing moved.

### Phase 2 — SQLite driver ports and the core move

| Step | Change | Gate |
|---|---|---|
| 2.1 | **Move the core**: `apps/book-reader-sdk/{src,tests}` → `source/core/{src,tests}`; `packages/config` → `source/core/src/config`; alias `@reading-book/book-reader-sdk` and `@reading-book/config` point at the new folders (old import names kept for now); drop `dist/` build, `build.mjs`, rolldown (FR-012) | G-base; core tests count ≥ 1016 |
| 2.2 | **Driver ports** in `source/core/src/db/driver.ts`: `SyncSqlDriver`, `AsyncSqlDriver` (contracts/sql-drivers.md); Desktop `db.ts` exposes a `better-sqlite3` implementation of `SyncSqlDriver`; Mobile `host-sql-driver.ts` implements `AsyncSqlDriver` | G-base; core unit tests of the ports on `node:sqlite` |
| 2.3 | **Schemas + migrations into core**: Desktop `electron/persistence/migrations/*.sql` → `source/core/src/db/desktop/migrations/` (byte-identical, 30 files), Mobile `web/src/db/migrations` → `source/core/src/db/mobile/migrations/`; runners read them from there | G-base; `check:desktop-baseline` "no new or removed migration" + hashes of the 30 files unchanged; `spike:audio:migration` |
| 2.4–2.8 | **One store per step** — library, overlay, txt, audio, transcript: statements (`{sql, params}`) and row codecs move to `source/core/src/db/<store>/`; the Desktop store becomes a synchronous executor over `SyncSqlDriver` in place, the Mobile store an asynchronous one; transactions stay where they are (R3) | G-base + that store's spikes (library: `session:roundtrip`, `annotations:main`; overlay: `pdf:annotations`, `pdf:embedded`, `pdf:two-way`; txt: `txt:main`, `txt:store`; audio: `audio:main`, `audio:chapters`, `audio:zip-import`; transcript: `transcription:main`) + Mobile `stores.test.ts`, `contract-conformance.test.ts` |
| 2.9 | Retire the SDK's unused `persistence/sql-notes.ts` (not production, spec 008 FR-023) or rebase it on the new codecs; update `check:boundaries` for `source/core` | `check:boundaries` 6/6 + negative tests |

**Phase 2 exit**: `source/core` holds all shared logic incl. database logic; no driver import in it (R1–R3 green).

### Phase 3 — `source/app` and platform adapters

| Step | Change | Gate |
|---|---|---|
| 3.1 | **Move the UI**: `apps/reading-book-desktop/src` → `source/app` (`screens/`, `components/` ← `components`+`chrome`+`reader`, other folders as siblings); `index.html` into `source/app`; aliases `@app/*`; both Vite configs point at it | G-base; `npx vite build` asset list compared with Phase 1 (same chunks, R10 of spec 008) |
| 3.2 | **Adapters, one concern per step** (contracts/platform-adapters.md): `api` (replaces the Mobile `web/src/main.ts` window.api injection and Desktop's preload global), `host` (replaces `src/platform/index.ts` signal), `storage`, `window`; `.electron.ts` / `.native.ts` pairs; `vite` `resolve.extensions` + `tsconfig.{electron,native}.json` `moduleSuffixes` (R4); `check-platform-adapters.mjs` | G-base + `check:platform-adapters`; Desktop bundle contains no `.native` module and the WebView bundle no `.electron` one (bundle grep) |
| 3.3 | **Desktop host** → `source/app/platforms/electron/` (`electron/**`, `spikes/`, `e2e/`, `scripts/`, `resources/`, `assets/`, `electron-builder.json5` paths), `host-adapters/` with it; `vite-plugin-electron` entries updated | G-base; `e2e:typecheck`; a short spike run per area (`session:roundtrip`, `pdf:annotations`, `txt:main`, `audio:main`); `npm run dev` opens Desktop |
| 3.4 | **Mobile host** → `source/app/platforms/native/` (`src/host`, `src/app` → `routes/`, `web/src/{bridge,stores,db}`, `modules/local-server`, `plugins/`, `scripts/`); Expo Router `root`, Metro, `expo-module` autolinking paths; the WebView entry imports `@app/main` | Mobile `typecheck`, tests (111), `build:web`; `npx expo start` + Expo Go Library/import/Reader (user, SC-007); `npx expo prebuild -p android` + `:local-server:testDebugUnitTest` (13) |
| 3.5 | Remove the now-empty `source/apps`, `source/packages`; old import names (`@reading-book/*`) replaced by `@core/*`; `check:boundaries` rules re-pointed (contracts/dependency-rules.md) | G-base; boundaries negative tests still fail as designed |

**Phase 3 exit**: the user's tree exists; only `source/core`, `source/app`, `source/scripts` under `source/`.

### Phase 4 — Root build, scripts, CI and final verification

| Step | Change | Gate |
|---|---|---|
| 4.1 | **Root scripts** complete (contracts/root-commands.md): `dev`, `dev:mobile`, `dev:all`, `build`, `package`, `check`, `test`, `typecheck`, `lint`, `e2e*`, every `spike:*`, `android`, `build:web`, `check:*`; old commands listed as retired | Every script in the table runs (or is listed as needing hardware) |
| 4.2 | **Packaging**: `electron-builder` `files` allowlist (R6) + `check-desktop-package.mjs` (asar contains no `react-native`, `expo`, `platforms/native`) | `npm run package` (Windows) installs and starts; package check passes; installer size compared with before |
| 4.3 | **CI**: `.github/workflows/ci.yml` installs once at the root (`npm ci`) and runs `npm run check` | CI green on the branch |
| 4.4 | **Docs**: `CLAUDE.md`, READMEs (root, mobile section), SDS §2.7/§2.11/§2.12, spec 008 paths, `docs/implementation_plan/mobile_webview.md` (FR-021); clean-up script for old per-folder installs (FR-020) | Docs grep: no `source/apps/` path left outside history sections |
| 4.5 | **Final verification** (quickstart.md): fresh clone → 2 commands per host (SC-001), 1 install folder + 1 lock (SC-002), size (SC-004), Desktop baseline (SC-005), boundaries (SC-006), Expo Go journey (SC-007, user), Desktop E2E (user's agreement), Android APK build | All SC recorded in `quickstart.md` §Results |

## Risks

| Risk | Where | Mitigation |
|---|---|---|
| React 19 breaks a Desktop screen in a way types do not catch | 1.2 | Spikes on the real stores + E2E with the user's agreement before any move |
| TS 6 / ESLint 9 deprecations produce many errors | 1.3 | Separate step; fix config first, code second; `--max-warnings 0` kept |
| electron-builder packs Expo / RN into the installer | 4.2 | Files allowlist + asar check |
| Metro at the repo root crawls Desktop output / huge folders | 1.5, 3.4 | `blockList`; `watchFolders` limited to `source/` |
| Expo autolinking does not find `platforms/native/modules/local-server` | 3.4 | `expo.autolinking.nativeModulesDir` in the root manifest; Kotlin tests in the gate |
| Synchronous transaction semantics lost while moving SQL | 2.4–2.8 | Executors keep control flow; `annotations:main` / `annotations:perf` spikes in the gate |
| Windows path length returns | 3.3, 3.4 | Paths get shorter (no `source/apps/reading-book-*`); short `.cxx` plugin kept |
| Long migration leaves `main` broken mid-way | all | One step = one commit, gate before commit; work on `anle-dev` |

## Complexity Tracking

| Cost | Why needed | Simpler alternative rejected because |
|---|---|---|
| Two driver ports (sync + async) | Desktop's import transaction must stay synchronous; Mobile's driver is asynchronous (R3) | One async port breaks Desktop transactions; one sync port is impossible over `postMessage` |
| Three tsconfigs (`electron`, `native`, `core`) on one root base | `moduleSuffixes` differs per host; core keeps `types: []` | One tsconfig cannot type-check both suffix sets or keep core free of DOM / Node types |
| Files allowlist + asar check for the desktop package | One manifest lists mobile deps too (R6) | A second manifest for packaging violates FR-009 |
