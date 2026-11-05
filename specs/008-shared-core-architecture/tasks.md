# Tasks: Readmate Mobile as an Expo WebView Host of the Existing React UI

**Input**: Design documents from `specs/008-shared-core-architecture/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Scope**: Milestones M0 to M5. M5 ends **iOS-ready, not iOS-tested**. M6 (Docker test environment, iOS journey) is a separate task at the user's request, and the first release is not complete until it passes.

**Updated 2026-11-02 for Expo Go (FR-017k to FR-017m)**: existing task IDs are kept, because decision records refer to them, so T082 onward are placed where they run rather than in number order. Phase 2 passes provisionally on Expo Go. Native-build checks moved to the new Phase 6b.

**Tests**: Included, because the spec requires boundary checks, contract fixtures, conformance suites and a device journey (FR-005, FR-019, FR-022, FR-017).

**Rules for every task**:

- Follow the compatibility rules in `plan.md` (FR-017j): no Windows-only scripts, exact-case imports, no Android-only solution.
- Desktop edits are additive. After any Desktop edit, run the checks in `quickstart.md` section 1. Do not run Desktop E2E unless the user asks.
- Read the versioned Expo 57 docs before Mobile code, as `source/apps/reading-book-mobile/AGENTS.md` requires.
- Commit or push only when the user asks in this feature's context; the planning requests said not to.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 to US6 from `spec.md`

## Path Conventions

- `MOBILE` is not used as a variable: all paths are written from the repo root.
- Host: `source/apps/reading-book-mobile/src/`. WebView code: `source/apps/reading-book-mobile/web/`. Desktop UI: `source/apps/reading-book-desktop/src/`.

---

## Phase 1: Setup (M0 baseline, M1 workspace)

**Purpose**: A trustworthy baseline and a workspace that can build Mobile without touching Desktop's behaviour.

- [X] T001 **Stop and ask the user** whether `audiobookZipImportEnabled` and `audiobookTranscriptionEnabled` go back to `false` (recommended, matching the file's comment and CLAUDE.md) or the 2 failures are accepted, then apply the answer in `source/packages/config/features.ts`
- [X] T002 Run SDK typecheck, test typecheck, tests and build, plus Desktop typecheck, lint, `e2e:typecheck` and `npx vite build`, and record results in `specs/008-shared-core-architecture/baseline.md`
- [X] T003 [P] Mark spec 003 as superseded by spec 008 with a note at the top of `specs/003-unified-app-codebase/spec.md` (OD-9)
- [X] T004 Confirm a clean `npm ci` in `source/` from `source/package-lock.json` alone, then delete `source/apps/reading-book-desktop/package-lock.json` and `source/apps/reading-book-mobile/package-lock.json` (FR-017e); if `npm run dev:desktop` or any baseline check breaks, restore them and report
- [X] T005 Run `npm ls react react-dom react-native` and list every package nested under an app, with its reason, in `specs/008-shared-core-architecture/workspace-exceptions.md` (FR-017f)
- [X] T006 [P] Remove the stale `@reading-book/shared` aliases, keeping `@/` aliases, in `source/apps/reading-book-mobile/babel.config.js`
- [X] T007 [P] Remove the manual `watchFolders`, because Expo's docs say not to set it since SDK 52 and `expo/metro-config` configures monorepos automatically, in `source/apps/reading-book-mobile/metro.config.js`; one React copy confirmed from the lockfile graph; the real bundle check moves to T016 (see `baseline.md`)
- [X] T008 [P] Set `ios.bundleIdentifier` and `android.package` to `com.anle.readmate`, and the built-in `ios.deploymentTarget` to `18.2`, in `source/apps/reading-book-mobile/app.json`, then confirm with `npx expo config --type public`
- [X] T009 Add `react-native-webview`, `expo-sqlite`, `expo-file-system` and `expo-document-picker` with `npx expo install`, in `source/apps/reading-book-mobile/package.json`, after T010's records exist; update `source/package-lock.json` and rerun the Desktop checks
- [X] T010 [P] Write one completed decision record per dependency in T009, using the fields of FR-030 plus iOS and Apple-silicon support, in `specs/008-shared-core-architecture/decisions/`
- [X] T011 Create the Vite config without the Electron plugin: root at `web/`, aliases for `@reading-book/config` and the SDK source, `react` and `react-dom` aliased to the root 18.3.1 copy, in `source/apps/reading-book-mobile/web/vite.config.ts`
- [X] T012 Create the page without remote fonts and with a strict CSP in `source/apps/reading-book-mobile/web/index.html`
- [X] T013 Create the entry that installs a temporary `window.api` stub and declares the Mobile signal, then imports Desktop's `src/main.tsx`; add `@source` for Desktop's `src/` to its CSS, in `source/apps/reading-book-mobile/web/src/main.ts`
- [X] T014 Add `build:web`, implemented as a Node `.mjs` script that builds and copies output into the app's asset location, in `source/apps/reading-book-mobile/scripts/build-web.mjs` and `source/apps/reading-book-mobile/package.json`
- [X] T015 Add the Mobile web build and Mobile typecheck as separate steps, without weakening any existing step, in `.github/workflows/ci.yml` (FR-031)

**Checkpoint**: SC-011 passes; `npm run dev:desktop` starts; Desktop checks match the baseline.

---

## Phase 2: Foundational (Expo Go mode, then provisional M2) ⚠️ Gate

**Purpose**: Make `npx expo start` show the UI in Expo Go (FR-017k), then prove the UI runs in a WebView before building the bridge. This code is a feasibility build; keep what holds up.

**⚠️ CRITICAL**: No user story implementation that depends on the WebView (US3) begins until T024 is complete. **If a format fails, stop and report to the user.**

### `npx expo start` in Expo Go

- [X] T082 Add a Mobile `postinstall` that links `source/node_modules/expo` to Mobile's `expo` with `fs.symlinkSync(target, path, 'junction')`, replaces only an existing link, and exits quietly if Mobile's `expo` is missing (`research.md` R10), in `source/apps/reading-book-mobile/scripts/link-expo-root.mjs` and `source/apps/reading-book-mobile/package.json`
- [X] T083 Run `npm ci` then `npm install` in `source/`, confirm the link survives both and `npx expo start` reaches "Waiting on", rerun `quickstart.md` section 1, and confirm with `npx electron-builder --dir` that no Expo package enters Desktop's package; record results in `specs/008-shared-core-architecture/baseline.md` and the link in `specs/008-shared-core-architecture/workspace-exceptions.md`; if Desktop changes, remove the link and report
- [X] T016 Replace the template route with one screen holding a `WebView`, and remove the template `explore` route, in `source/apps/reading-book-mobile/src/app/index.tsx`, `source/apps/reading-book-mobile/src/app/_layout.tsx` and `source/apps/reading-book-mobile/src/app/explore.tsx` (already done in the working tree: confirm it), then confirm `npx expo export` succeeds for Android and iOS with one React copy, and correct the Metro failure section of `specs/008-shared-core-architecture/baseline.md`
- [X] T084 Add a Metro middleware serving `web/dist` at `/readmate-ui/` through `config.server.enhanceMiddleware`: GET and HEAD only, correct MIME types (`.mjs` as JavaScript, `.wasm`), path traversal refused, and a page saying to run `npm run build:web` when `web/dist` is missing, in `source/apps/reading-book-mobile/scripts/ui-middleware.cjs` and `source/apps/reading-book-mobile/metro.config.js`
- [X] T085 [P] Add `dev:web` (`vite build --watch` with the config in `web/`), keeping `build:web` as is, in `source/apps/reading-book-mobile/package.json`
- [X] T086 Add `resolveUiSource()`: when `__DEV__` is true and `Constants.executionEnvironment` is `storeClient`, return `http://{Constants.expoConfig.hostUri}/readmate-ui/index.html`; otherwise `require` the local server inside the branch and return its URL; a missing `hostUri` gives a clear error, in `source/apps/reading-book-mobile/src/host/ui-source.ts` and `source/apps/reading-book-mobile/src/host/local-server.ts`
- [X] T087 Use `resolveUiSource()` in the screen, with `originWhitelist` and `onShouldStartLoadWithRequest` allowing only the resolved origin; a release build must never select the Metro route, in `source/apps/reading-book-mobile/src/app/index.tsx`
- [X] T088 [P] Add `crypto.randomUUID` (through `crypto.getRandomValues`) and a harmless `navigator.clipboard`, each only when absent, and install them before the Desktop UI import (`research.md` R13), in `source/apps/reading-book-mobile/web/src/secure-context-shims.ts` and `source/apps/reading-book-mobile/web/src/main.ts`
- [X] T089 Run `npm run typecheck`, `npm run typecheck:web` and `npm run build:web`; start `npx expo start` and confirm the host bundle and `/readmate-ui/index.html` both answer on the computer, and that the `/readmate-ui/` assets load in a desktop browser, in `source/apps/reading-book-mobile/`; record results in `specs/008-shared-core-architecture/m2-results.md`
- [X] T090 **Needs the user's phone.** Ask the user to scan the QR code with Expo Go on the same Wi-Fi, and record the Expo Go and Android versions, whether SDK 57 loads, whether LAN `http` loads in the WebView, and whether the Readmate UI appears (FR-017k) in `specs/008-shared-core-architecture/m2-results.md`; on failure, diagnose and report before going further

**Checkpoint**: `npx expo start` shows the Readmate UI in Expo Go.

### Provisional M2 on Expo Go (FR-017m)

- [X] T018 Confirm that the local server in `source/apps/reading-book-mobile/modules/local-server/` and `source/apps/reading-book-mobile/src/host/local-server.ts` matches `specs/008-shared-core-architecture/decisions/local-file-server.md`, and typechecks; running it moves to T092
- [X] T019 Confirm the Android cleartext rule covers `127.0.0.1` only, and the iOS equivalent, through the config plugin in `source/apps/reading-book-mobile/plugins/with-loopback-cleartext.js` and `source/apps/reading-book-mobile/app.json`; never allow global cleartext
- [X] T020 Confirm the feasibility harness has fixed sample books for EPUB, PDF, TXT and Markdown, and a fake `window.api` that serves them through relative URLs under `/readmate-ui/`, fixing it if needed, in `source/apps/reading-book-mobile/web/src/feasibility/`
- [X] T021 **Needs the user's phone.** Run `npm run build:web:feasibility`, then in Expo Go record render, page turns, the PDF.js worker and text selection for all 4 formats in `specs/008-shared-core-architecture/m2-results.md`; memory, offline and restart results are out of this run. If a format fails, stop and report
- [X] T022 [P] Run the same web build in Playwright WebKit with the fake host, and record differences as early warnings, not iOS proof, in `specs/008-shared-core-architecture/m2-results.md`
- [X] T023 [P] Run `sqlite_version()` and a JSON function check through `expo-sqlite` in Expo Go (`EXPO_PUBLIC_FEASIBILITY=1`, `source/apps/reading-book-mobile/src/host/feasibility-sqlite.ts`), confirm FTS is not needed, and note that a native build may ship a different SQLite, in `specs/008-shared-core-architecture/m2-results.md`
- [X] T024 Record OD-4 and a provisional OD-10, working values for Android minimum and book size limit, and bundled fonts with confirmed licences, and list as **unverified**: offline start, local server, `file://`, 100 MB books, `localStorage` after a restart, in `specs/008-shared-core-architecture/m2-results.md`; review phone UI effort against `ReaderScreen.tsx` and report to the user if additive changes will not be enough

**Checkpoint**: Provisional M2 results and the unverified list recorded; the user has been told of any failure or design change.

---

## Phase 3: User Story 1 - Desktop users notice nothing (Priority: P1)

**Goal**: A repeatable way to prove Desktop is unchanged, used at every later step.

**Independent Test**: Open a library made before this work in the new build and compare; all checks match `baseline.md`.

- [X] T025 [US1] Add a Node script that runs the Desktop and SDK checks and compares them with the baseline, in `source/scripts/check-desktop-baseline.mjs`
- [X] T026 [US1] Make a copy of a pre-change library in a throw-away `userData` folder, and record the procedure and expected counts (books, positions, annotations, bookmarks, Notes) in `specs/008-shared-core-architecture/baseline.md`
- [X] T027 [US1] Confirm no file changed under `source/apps/reading-book-desktop/electron/` and no new migration, using `git diff`, and add this as a step in `source/scripts/check-desktop-baseline.mjs`

**Checkpoint**: The baseline check runs in one command. US1 is finally judged in T078.

---

## Phase 4: User Story 2 - A forbidden dependency fails the checks (Priority: P1)

**Goal**: Boundaries enforced by checks, not by install layout (M3).

**Independent Test**: Each probe in `architecture-audit.md` §3 fails the check with a message naming the rule.

### Tests for User Story 2

- [X] T028 [P] [US2] Write negative tests, one per probe plus rules R3, R5, R7, R8, R9 and R11, using temporary fixture files, in `source/scripts/boundaries/boundaries.test.mjs`

### Implementation for User Story 2

- [X] T029 [US2] Implement an import checker for SDK `src` with an allowlist of `zustand/vanilla` and relative paths staying inside `src`, independent of what is installed, in `source/scripts/boundaries/check-sdk-imports.mjs` (R2, R3)
- [X] T030 [P] [US2] Implement the app rules: Desktop and Mobile never import each other, except Mobile's `web/` importing Desktop's `src/`; host code imports no `electron`, DOM libraries, or `host-adapters`, in `source/scripts/boundaries/check-app-imports.mjs` (R7, R8, R11)
- [X] T031 [P] [US2] Check that the Mobile UI bundle graph has no `electron/` runtime import, allowing only `electron/pdf-sync/pdf-font-embed.ts` and type-only imports (see Complexity Tracking in `plan.md`), in `source/scripts/boundaries/check-mobile-ui-graph.mjs`
- [X] T032 [P] [US2] Check the workspace dependency graph for cycles over manifests and imports, in `source/scripts/boundaries/check-workspace-graph.mjs` (R5, FR-006)
- [X] T033 [P] [US2] Add a `no-restricted` rule keeping `window.api` inside `src/bridge`, in `source/apps/reading-book-desktop/.eslintrc.cjs` (R9); lint must stay green with `--max-warnings 0`
- [X] T034 [P] [US2] Check that git-ignored OAuth secret files are absent from Desktop and Mobile bundle output, in `source/scripts/boundaries/check-no-secrets.mjs` (FR-033)
- [X] T035 [US2] Add `check:boundaries` to `source/package.json` and as a CI step in `.github/workflows/ci.yml`; list any existing exception explicitly in `source/scripts/boundaries/exceptions.json`

**Checkpoint**: SC-003 passes.

---

## Phase 5: User Story 4 - Both apps agree on what reading data means (Priority: P2)

**Goal**: Contract fixtures and Mobile's schema (M3). Runs before US3, since the stores need it.

**Independent Test**: Fixtures pass against Desktop's stores with no Desktop change, and against an in-memory implementation.

### Tests for User Story 4

- [X] T036 [P] [US4] Create versioned fixtures taken from real shapes, one per `note_json` kind (EPUB, PDF `page-rect` with `pdfAnnotation`, Markdown `mdAnnotation`, TXT `txtAnnotation`, bookmark) plus `reading_state_json`, in `source/apps/book-reader-sdk/tests/contracts/fixtures/`
- [X] T037 [US4] Add an SDK test proving `persistence/sql-notes.ts` mismatches the fixtures, in `source/apps/book-reader-sdk/tests/contracts/sql-notes-mismatch.test.ts` (acceptance 4.2)
- [X] T038 [US4] Add a local script running the fixtures against `SqliteOverlayStore` and `SqliteLibraryStore` on the migrated schema, using the Electron-ABI relaunch as `spike:audio:migration` does, in `source/apps/reading-book-desktop/spikes/mobile-contract-fixtures.mts`, plus a `spike:contract:fixtures` entry in `source/apps/reading-book-desktop/package.json`

### Implementation for User Story 4

- [X] T039 [P] [US4] Mark `persistence/sql-notes.ts` as not for production use and correct its "matching the desktop SQLite layout" comment, in `source/apps/book-reader-sdk/src/persistence/sql-notes.ts` (FR-023; comment only)
- [X] T040 [US4] Dump the real schema from a fully migrated Desktop database with a Node script, in `source/apps/reading-book-mobile/scripts/dump-desktop-schema.mjs`
- [X] T041 [US4] Write the baseline for first-release tables, confirming from T040 which genre tables the library UI reads and whether bookmarks use `notes`, and dropping JSON checks only if T023 says so, in `source/apps/reading-book-mobile/web/src/db/migrations/001_baseline.sql`
- [X] T042 [US4] Implement a migration runner over the SQL driver, in `source/apps/reading-book-mobile/web/src/db/migrate.ts`
- [X] T043 [US4] Define the `SqlDriver` interface matching `contracts/host-services.md` (`query`, `run`, `transaction`), plus a test driver on `node:sqlite`, in `source/apps/reading-book-mobile/web/src/db/sql-driver.ts` and `source/apps/reading-book-mobile/web/tests/node-sqlite-driver.ts`
- [X] T044 [US4] Implement `MobileLibraryStore` with these rules: `id` "UUID"; `sha256` "Unique; same algorithm as Desktop"; `file_path` relative `books/{id}/file`, "never" absolute; `cover_path` relative `covers/{id}.png`; `file_format` one of `epub`, `pdf`, `txt`, `md`; `signatureStatus` stays absent; in `source/apps/reading-book-mobile/web/src/stores/library-store.ts`
- [X] T045 [US4] Implement `MobileOverlayStore` for session state, bookmarks and highlights, with identical `note_json`, Main's re-validation reused from SDK functions where they exist, and preserving unknown kinds on read; resolve the TXT row question in `data-model.md`; in `source/apps/reading-book-mobile/web/src/stores/overlay-store.ts`
- [X] T046 [US4] Write a conformance suite over the fixtures, run on the Mobile stores through `node:sqlite`, in `source/apps/reading-book-mobile/web/tests/contract-conformance.test.ts` (FR-019); add vitest and a `test` script in `source/apps/reading-book-mobile/package.json`, and a CI step in `.github/workflows/ci.yml`

**Checkpoint**: SC-006 passes; `spike:contract:fixtures` and the Mobile suite both pass.

---

## Phase 6: User Story 3 - The existing UI runs inside the Mobile app (Priority: P1) 🎯 MVP

**Goal**: The first-release journey on Android (M4 + M5), iOS-ready.

**Independent Test**: During development, the journey in Expo Go with books up to 20 MB. For acceptance, `quickstart.md` section 5 on a native Android build, networking off, for all 4 formats (Phase 6b).

**Depends on**: Phase 2 and Phase 5.

### Tests for User Story 3

- [X] T047 [P] [US3] Write bridge tests with a fake host: `DesktopApi` type satisfied, not-available behaviour, safe empty results, serialized writes, the chunked `openBookContent` route and its 20 MB refusal, in `source/apps/reading-book-mobile/web/tests/bridge.test.ts`
- [X] T048 [P] [US3] Write import tests: success, duplicate, cancel, no space, commit failure cleanup, startup sweep, following the state flow in `data-model.md`, in `source/apps/reading-book-mobile/web/tests/import.test.ts`
- [X] T049 [P] [US3] Write removal tests: rows then files; only app-private paths, in `source/apps/reading-book-mobile/web/tests/remove-book.test.ts`

### Host services (M4)

- [X] T050 [US3] Implement the RPC dispatcher with the `v: 1` envelope, origin check and `UNKNOWN_METHOD`, per `contracts/host-services.md`, in `source/apps/reading-book-mobile/src/host/rpc.ts`
- [X] T051 [P] [US3] Implement `sql.query`, `sql.run`, and `sql.transaction` in `withExclusiveTransactionAsync`, in `source/apps/reading-book-mobile/src/host/sql-service.ts`
- [X] T052 [US3] Implement `files.pick` with copy to cache, and `files.stage`, `hashStaged` (chunked, per `research.md` R7), `commitStaged`, `discardStaged`, `removeBook` (UUID validated), `writeCover`, `sweep`, with no route writing to an imported book, in `source/apps/reading-book-mobile/src/host/file-service.ts`
- [X] T053 [P] [US3] Implement `app.info`, and `app.openExternal` (`https` only, allowlist), in `source/apps/reading-book-mobile/src/host/app-service.ts`
- [X] T054 [US3] Add book and cover routes with per-launch token, `Range` handling (`206`, `416`), MIME and `Cache-Control: no-store`, in `source/apps/reading-book-mobile/src/host/local-server.ts` and `source/apps/reading-book-mobile/modules/local-server/`; these compile now and run in T092. **Status 2026-11-04**: written for Kotlin and Swift, with Kotlin unit tests for the token, `Range`, `416` and UUID-only routes in `LoopbackServerTest.kt`; **not compiled yet**: `gradlew --offline :local-server:testDebugUnitTest` stops because `react-android` 0.86.3 and `hermes-android` are not in the Gradle cache, and fetching them is the T092 build. Swift cannot be built on Windows (M6). Mark done when T092 runs the Kotlin tests **Done 2026-11-05**: `gradlew :local-server:testDebugUnitTest` runs the 13 Kotlin tests, all pass (after removing 4 lone carriage returns inside string literals that stopped `compileDebugKotlin`, see `m5-results.md`). Swift still unbuilt (M6)
- [X] T091 [US3] Implement the development-only `files.readChunk` per `contracts/host-services.md`: `length` at most 1 MiB, `bookId` validated as a UUID, app-private books only, `BOOK_TOO_LARGE_FOR_DEV` above 20 MB, and `UNKNOWN_METHOD` in every other build, in `source/apps/reading-book-mobile/src/host/file-service.ts`; make the RPC origin check in `source/apps/reading-book-mobile/src/host/rpc.ts` accept the origin from `resolveUiSource()`
- [X] T055 [US3] Implement lifecycle: background flush event, foreground server check, reload on `onRenderProcessGone` and `onContentProcessDidTerminate`, Android back; boot values through `injectedJavaScriptObject` or a boot request on Android; restrict navigation, in `source/apps/reading-book-mobile/src/app/index.tsx` and `source/apps/reading-book-mobile/src/host/lifecycle.ts`

### Mobile Bridge (M4)

- [X] T056 [US3] Implement the WebView RPC client and single write queue, in `source/apps/reading-book-mobile/web/src/bridge/host-client.ts`
- [X] T057 [P] [US3] Implement the `app` group, in `source/apps/reading-book-mobile/web/src/bridge/app.ts`
- [X] T058 [US3] Implement the `library` group per `contracts/mobile-bridge.md`, with `openBookContent` fetching from the local server, or through `files.readChunk` when there is none, `coverUrl` built per launch, or as a `data:` URL when there is no server, and `removeBook` removing rows then files, in `source/apps/reading-book-mobile/web/src/bridge/library.ts`
- [X] T059 [US3] Implement the `overlay` group, in `source/apps/reading-book-mobile/web/src/bridge/overlay.ts`
- [X] T060 [US3] Implement `import.fromFile`, `cancel`, `onProgress` following the job flow, with metadata and covers in the WebView reusing the SDK `epub/` parser and `generateBookCover.ts` where possible and a filename fallback, in `source/apps/reading-book-mobile/web/src/bridge/import.ts`
- [X] T061 [P] [US3] Implement `txt.open`, always read-only, in `source/apps/reading-book-mobile/web/src/bridge/txt.ts`
- [X] T062 [US3] Implement safe empty results and `NotAvailableOnPlatformError` for all other methods, in `source/apps/reading-book-mobile/web/src/bridge/unavailable.ts`
- [X] T063 [US3] Assemble the object typed as `DesktopApi` (type-only import), and replace the stub in the entry, in `source/apps/reading-book-mobile/web/src/bridge/index.ts` and `source/apps/reading-book-mobile/web/src/main.ts`
- [ ] T064 [US3] Log every bridge call during a journey run, and fix any `NOT_AVAILABLE_ON_PLATFORM` reached, updating `specs/008-shared-core-architecture/contracts/mobile-bridge.md`. **Status 2026-11-04**: the log is in place (`withCallLog` in `web/src/bridge/index.ts`, `window.__readmateBridgeLog`); the journey run itself **needs the user's phone** in Expo Go

**Checkpoint (M4)**: With the unadapted UI in Expo Go, import, read, annotate and restart work for books up to 20 MB. SC-010 is finally judged in T074.

### Phone UI (M5)

- [X] T065 [US3] Add `isMobileHost()` and `isFeatureAvailable()` (always true when not on the Mobile host), in `source/apps/reading-book-desktop/src/platform/index.ts`
- [X] T066 [US3] Add scoped rules for layout and safe areas, in `source/apps/reading-book-desktop/src/styles/phone.css`, imported from `source/apps/reading-book-desktop/src/index.css`; rules sit inside `@media (max-width: 899.98px)` and under `data-mobile-host`
- [X] T067 [US3] Remove first-release-excluded capabilities on the Mobile host only, in `source/apps/reading-book-desktop/src/reader/capabilities.ts`
- [X] T068 [P] [US3] Hide cloud, URL, audiobook ZIP and annotation transfer entries in `source/apps/reading-book-desktop/src/screens/Library/`
- [X] T069 [P] [US3] Hide excluded Settings groups in `source/apps/reading-book-desktop/src/screens/Settings/`
- [X] T070 [US3] Add a compact phone navigation component, and show it instead of `AppTitlebar` and `AppMenubar` on the Mobile host, in `source/apps/reading-book-desktop/src/chrome/`
- [X] T071 [US3] Add long-press for the right-click menus of the 16 files found by the audit, through one small shared helper, in `source/apps/reading-book-desktop/src/platform/long-press.ts`
- [X] T072 [US3] Make hover-only controls reachable on the Mobile host, outside the Reader (the Mobile Reader has its own layout, T100 to T103), in `source/apps/reading-book-desktop/src/styles/phone.css` and the affected Library and Settings components
- [X] T073 [US3] Adjust JavaScript-measured menus (for example `source/apps/reading-book-desktop/src/screens/Library/components/book/BookItemMenu.tsx`) in phone branches only, outside the Reader, using M2 findings

**Status 2026-11-04 (T065–T073, T097, T098)**: Desktop `typecheck`, `lint`, `npx vite build`, `spike:session:roundtrip`, `spike:txt:store`, `spike:settings:reset` pass; Mobile `typecheck:web`, `build:web`, 107 tests and `check:boundaries` pass. `spike:reader:toolbar` fails on one assertion (the audiobook `transcript` tab), and fails the same way with `capabilities.ts` at `HEAD`: the cause is `audiobookTranscriptionEnabled: false` in the working tree's `packages/config/features.ts` (M0), not this work; the spike's expectation needs updating with that decision. **Not done**: the manual Desktop check of each format after T097 and T098 (open at the saved position, turn pages, highlights / notes / bookmarks after a restart), which needs the user; and on-device checks of long press (R1) and the phone layout, which belong to T094–T095.

### Mobile Reader UI (M5, FR-012a, FR-012c; decided 2026-11-03)

**Rules**: `contracts/phone-ui.md` "Mobile Reader UI". Desktop's Reader keeps its behaviour and look. Reuse stores, hooks, renderers and the bridge; no copied logic; no Mobile-only store without a recorded reason. **If a risk check fails, or a step would change what a hook does, stop and report to the user.**

**Risk checks first** (Expo Go, feasibility build; no Desktop change):

- [X] T094 [US3] Check R1, R3 and R6 on the device: long press on text and on a mark in EPUB, PDF and Markdown, which events reach the renderers, where the selection is reported, and the note editor with the soft keyboard; record in `specs/008-shared-core-architecture/m5-results.md` **Checked 2026-11-05 at the user's request, NOT run on a device**: deferred until the app runs end to end; the Mobile Reader was built without it (T101–T103)
- [X] T095 [US3] Check R2, R4 and R5 on the device with a throwaway tap-zone and swipe prototype in the feasibility build only (`source/apps/reading-book-mobile/web/src/feasibility/`): selecting text never turns the page, each format at 360 × 640 and in landscape, rotation while reading, memory over 50 PDF pages; record in `specs/008-shared-core-architecture/m5-results.md`, then delete the prototype **Checked 2026-11-05 at the user's request, NOT run on a device**: deferred until the app runs end to end; the Mobile Reader was built without it (T101–T103)
- [X] T096 [US3] Report T094 and T095 to the user, and update the scope and layout in `specs/008-shared-core-architecture/contracts/phone-ui.md` if a check failed **Checked 2026-11-05 at the user's request, NOT run on a device**: deferred until the app runs end to end; the Mobile Reader was built without it (T101–T103)

**Moving wiring out of `ReaderScreen.tsx`** (one step per change; after each: Desktop `typecheck`, `lint`, `npx vite build`, `spike:reader:toolbar`, `spike:session:roundtrip`, `spike:txt:store`, and a manual Desktop check of each format; Desktop E2E only if the user agrees):

- [X] T097 [US3] Step 1: move the Markdown source and TOC and the TXT and Markdown initial positions into pure functions, called from `ReaderScreen.tsx` with the same inputs, in `source/apps/reading-book-desktop/src/screens/Reader/logic/reader-core/derivations.ts`
- [X] T098 [US3] Step 2: move `readingStyle` into a pure function beside step 1, in `source/apps/reading-book-desktop/src/screens/Reader/logic/reader-core/reading-style.ts`
- [X] T099 [US3] Step 3: move book open, session and navigation for the 4 formats, with the renderer refs, into `useReaderCore`, called by `ReaderScreen.tsx` in the same order with the same arguments; list every argument and keep Desktop-only ones as options (R8), in `source/apps/reading-book-desktop/src/screens/Reader/logic/reader-core/useReaderCore.ts`; ask the user about Desktop E2E (R7)
- [X] T100 [US3] Step 4: add bookmarks and EPUB, PDF-text and Markdown highlights on top of step 3, in `source/apps/reading-book-desktop/src/screens/Reader/logic/reader-core/`; run the PDF annotation spikes too; ask the user about Desktop E2E (R7)

**Status 2026-11-05 (T099, T100; Desktop E2E run with the user's agreement)**: full suite (84 tests, hidden mode) after steps 1–2: 67 passed / 9 failed; after step 3: 71 / 5; after step 4: 67 / 9. **No failure is caused by this work**:
- `epub-toc-regression` (E2E 7), `md-reader` E and `pdf-annotations` "EPUB highlights …" fail identically with every change of this feature stashed (`HEAD` Desktop source): existing failures, to be looked at separately.
- Every other failure passed when its spec was rerun alone on the same code (audio-reader ×4, audiobook-multitrack-notes, md-reader F, md-annotations, pdf-annotations "PDF (Hand)", pdf-cursor-zoom, pdf-ink-styles, pdf-typewriter-format, txt-annotations D), or failed the same way on step-3 code that had passed them before (`pdf-fit-page`, `pdf-typewriter`: environment, not code). Typical causes: `EBUSY` removing the temp `userData`, 30 s waits after an import, a 589 px viewport.
- Spikes after step 4: `session:roundtrip`, `txt:store` (19), `pdf:annotations` (39), `pdf:shape-store` (16) pass.
Effect order did change (R7): `useReaderCore` runs before the TXT store, relink, indexing, read aloud and translation hooks; `useReaderAnnotations` before shortcuts, the PDF selection menu, ink and graphics. No E2E showed a consequence.

**Mobile Reader UI** (after T096 and T100): T101–T103 were built on 2026-11-05 before T094–T096, because the user could not run the device checks yet (import on the phone failed); the device checks still run first in the journey, and a failed one changes these screens.

- [X] T101 [US3] Choose `MobileReaderScreen` with `React.lazy` when `isMobileHost()` is true, and `ReaderScreen` otherwise, in `source/apps/reading-book-desktop/src/screens/ReaderRoute.tsx`; compare Desktop's `npx vite build` chunks before and after (R10) **Done 2026-11-05** (`m5-results.md`, R10)
- [X] T102 [US3] Build the Mobile Reader screen on `useReaderCore`: full-screen page, tap to show the bars, top bar, bottom bar with progress, tap zones and swipe per T095, loading, error and missing-file states, in `source/apps/reading-book-desktop/src/screens/Reader/phone/MobileReaderScreen.tsx` and `source/apps/reading-book-desktop/src/screens/Reader/phone/components/` **Done 2026-11-05, before T094–T096 at the user's request**: tap zones only, swipe left for T095 (R2); not run on a device
- [X] T103 [US3] Add bottom sheets for TOC, bookmarks and notes, and appearance, using the existing stores, and the selection action bar and mark menu per T094, in `source/apps/reading-book-desktop/src/screens/Reader/phone/components/` **Done 2026-11-05, before T094–T096**: the selection bar does not rely on `contextmenu` (R1), see `contracts/phone-ui.md` "As built (T101–T103)"; not run on a device
- [ ] T104 [US3] Run a Mobile Reader journey for EPUB, PDF, TXT (read-only) and Markdown in Expo Go with the bridge-call log of T064 (R9: 0 `NOT_AVAILABLE_ON_PLATFORM`); confirm no Mobile-only store was added, or that its reason is in `contracts/phone-ui.md`; record in `specs/008-shared-core-architecture/m5-results.md`

**Checkpoint**: The phone UI works in Expo Go; Desktop unchanged at 900 px and above, and Electron's Reader unchanged.

### Phase 6b: The deferred Android build (FR-017l)

**Required before the first release counts as complete. Failures here may reopen bridge or M2 decisions, and must be reported to the user.**

- [ ] T092 [US3] Run `npm run build:web`, then `npx expo run:android` in `source/apps/reading-book-mobile/`; capture the full log, find the root cause of the failure the user has seen, fix it, and record both in `specs/008-shared-core-architecture/m5-results.md`. The app must use the local server, not the Metro route
- [ ] T017 [US3] On that build, record whether `file://` module scripts and the PDF.js worker run, using the `EXPO_PUBLIC_UI_ROUTE=file` branch in `source/apps/reading-book-mobile/src/app/index.tsx`, in `specs/008-shared-core-architecture/m2-results.md`; a failure is acceptable, as the local server is the chosen route
- [ ] T093 [US3] On that build, networking off, run every item T024 listed as unverified, and rerun the 4-format check and T023 in `specs/008-shared-core-architecture/m2-results.md`; finally close OD-10, set `minSdkVersion` in `source/apps/reading-book-mobile/app.json` if needed, and record the book size limit and `localStorage` durability
- [ ] T074 [US3] Run all of `quickstart.md` section 5 on that build, and record results in `specs/008-shared-core-architecture/m5-results.md` (SC-004 Android, SC-010)

**Checkpoint**: The MVP works offline on a native Android build.

---

## Phase 7: User Story 5 - A developer can tell where anything belongs (Priority: P2)

**Goal**: Docs match the code and the new design.

**Independent Test**: Ten sample capabilities placed correctly using the matrix alone (SC-007).

- [X] T075 [P] [US5] Correct the mismatches in audit §12 and add the Mobile architecture (host, bridge, web build, scripts), in `CLAUDE.md`, `source/apps/book-reader-sdk/README.md` and `docs/software/SDS.md`; replace the Mobile section in `source/apps/reading-book-mobile/README.md` (FR-032)
- [X] T076 [P] [US5] Write a feature map, plus a ten-capability placement exercise with answers checked against the matrix, in `docs/implementation_plan/mobile_webview.md`

---

## Phase 8: User Story 6 - New Mobile dependencies are decided on evidence (Priority: P3)

**Goal**: A reusable record and a check that it is used.

**Independent Test**: Fill the template for one sample library; every field can be completed.

- [X] T077 [P] [US6] Add the template (alternatives, Expo and React Native compatibility, iOS and Apple-silicon support, trade-offs, licence, maintenance) and a checklist that all Mobile native dependencies have records, in `specs/008-shared-core-architecture/decisions/TEMPLATE.md`. Create this before T010 and T018

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and iOS readiness.

- [ ] T078 Run `source/scripts/check-desktop-baseline.mjs`, the pre-change library check, a Desktop `npx vite build`, and `npm run dev:desktop`; ask the user whether to run Desktop E2E; record in `specs/008-shared-core-architecture/m5-results.md` (SC-001, SC-002) **Status 2026-11-05**: baseline script 25/25 pass (incl. the pre-change library) and `vite build` pass; `npm run dev:desktop` not started by the agent and Desktop E2E not asked yet: both wait for the user
- [X] T079 [P] Review all new scripts and Mobile code against the compatibility rules in `plan.md`, and list what is unproven on iOS, in `specs/008-shared-core-architecture/ios-readiness.md`
- [X] T080 [P] Check SC-005 (0 copied files, `window.api` only in `src/bridge`) and SC-009, and update statuses of closed Open Decisions in `specs/008-shared-core-architecture/spec.md` **Done 2026-11-05**: `check:boundaries` 6/6 (42 tests); 0 `window.api` outside `src/bridge`; 0 byte-identical Desktop / SDK files in Mobile; Open Decisions table has a Status column
- [X] T081 Report to the user: M0 to M5 results, and that M6 is required before the first release is complete, in `specs/008-shared-core-architecture/m5-results.md` **Done 2026-11-05** (`m5-results.md` "T081"; M6 and the device checks stay open)

---

## Dependencies & Execution Order

### Phase Dependencies

```text
Phase 1 (M0, M1) → Phase 2 (Expo Go, provisional M2 gate) → Phase 6 (US3) → Phase 6b (Android build)
Phase 1 → Phase 3 (US1) → used by all later Desktop edits
Phase 1 → Phase 4 (US2)
Phase 1 + T023 → Phase 5 (US4) → Phase 6 (US3)
Phase 6b → Phase 7, Phase 9
T077 (US6) before T010 and T018
```

Inside Phase 2: T082 → T083 → T016 → T084, T086 → T087 → T089 → T090 → T021, T023 → T024.

Mobile Reader UI: T094, T095 → T096 (need only the feasibility build, so they may run before M4). T097 → T098 → T099 → T100 (Desktop-only, one at a time; may run before M4). T096 + T100 + M4 checkpoint + T065 → T101 → T102 → T103 → T104.

### User Story Dependencies

- **US1**: After Phase 1. Independent.
- **US2**: After Phase 1. Independent. T031 needs T013.
- **US4**: After Phase 1 and T023. Independent of the phone UI.
- **US3**: After Phase 2 and US4. It is the MVP, despite being phased later, because it builds on the others.
- **US5**: Docs may start anytime, and finish after US3.
- **US6**: Do T077 first, in practice.

### Within Each User Story

Tests come before implementation. Host services precede the bridge, and the bridge precedes the phone UI. T001 needs the user's answer before anything else.

### Parallel Opportunities

- **Phase 1**: T003, T006, T007, T008, T010
- **Phase 2**: T085, T088; T022, T023
- **US2**: T028, T030, T031, T032, T033, T034
- **US4**: T036, T039
- **US3**: T047 to T049; T051, T053; T057, T061; T068, T069; T094, T095; T094 to T096 alongside T097 to T100 (different apps)
- **US5, US6**: T075, T076, T077

## Parallel Example: User Story 3

```text
T047 bridge tests        web/tests/bridge.test.ts
T048 import tests        web/tests/import.test.ts
T049 removal tests       web/tests/remove-book.test.ts
```

## Implementation Strategy

### MVP First

1. T077, then Phase 1 (T001 needs the user).
2. Phase 2 up to T090: `npx expo start` shows the UI in Expo Go. This is the first thing the user can see.
3. The rest of Phase 2. **Stop if the gate fails.**
4. Phase 3, a small safety net.
5. Phase 5, then Phase 6 up to the M4 checkpoint: the core journey runs in Expo Go with the unadapted UI.
6. M5 phone UI, then Phase 6b: the Android build and T074.

### Incremental Delivery

Each checkpoint can stop safely and leaves Desktop working: workspace → Expo Go → feasibility → boundaries → contracts → bridge → phone UI → Android build → docs.

### After This Feature

M6 runs as a separate task when the user asks: Docker test environment and any Mac setup (OD-11), the M2 recheck, the journey on iOS 18.2+, and fixing what it finds.
