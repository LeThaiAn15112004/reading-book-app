# Implementation Plan: Readmate Mobile as an Expo WebView Host of the Existing React UI

**Branch**: `008-shared-core-architecture` (spec directory; work currently sits on git branch `anle-dev`) | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-shared-core-architecture/spec.md`

> **Paths moved by spec 009** (`specs/009-single-project-monorepo/`, 2026-11-07): this plan is kept as written; the paths below are where its parts live now.
>
> | Spec 008 path | Since spec 009 |
> |---|---|
> | `source/apps/book-reader-sdk/src`, `…/tests` (incl. `tests/contracts/`) | `source/core/src`, `source/core/tests` (import `@core`) |
> | `source/packages/config` | `source/core/src/config` |
> | `source/apps/reading-book-desktop/src` (shared UI) | `source/app` (import `@app/*`) |
> | `source/apps/reading-book-desktop/src/platform/` | `source/app/platforms/host.*`, `longPress.*` (platform adapters) |
> | `source/apps/reading-book-desktop/electron` | `source/app/platforms/electron` |
> | `source/apps/reading-book-mobile/src/{app,host}`, `modules/` | `source/app/platforms/native/{routes,host}`, `modules/` |
> | `source/apps/reading-book-mobile/web/src/{main.ts,bridge,stores,db}`, `web/tests` | `source/app/platforms/native/{main.ts,bridge,stores,db}`, `native/tests` |
> | `reading-book-mobile/web/vite.config.ts` | `vite.config.ts` / `vite.native.config.ts` at the repository root |
> | `npm ci` in `source/`, `-w <workspace>` | `npm ci` at the repository root; one manifest, no workspaces |

## Summary

Run Desktop's existing React UI (`reading-book-desktop/src`) unchanged in structure inside a WebView in the Expo app. A second Vite build in the Mobile workspace uses that source as input and ships its output inside the app. A Mobile Bridge installs `window.api` before the UI starts, so `src/bridge/*` and the 52 UI files that import it need no change for this reason.

The main design choice is a **thin host**: bridge logic and SQLite stores are TypeScript running in the WebView, where the SDK already runs. The React Native side only exposes small native services: SQL, files, picker, lifecycle and a local file server. This avoids running the SDK on Hermes.

Phone layout is added inside `src/` as additive CSS below 900 px, with small phone-only branches behind a platform signal. The Reader is the exception (decided 2026-11-03, FR-012a, FR-012c): a separate touch-first Mobile Reader UI under `src/screens/Reader/phone/`, lazy-loaded and chosen by the signal, reusing Desktop's stores, hooks and renderers; the wiring it needs leaves `ReaderScreen.tsx` in small steps. Android is proven first. iOS 18.2+ is required for the first release, and its environment comes later (M6, OD-11).

**Update 2026-11-02 (FR-017k to FR-017m)**: daily development runs in Expo Go with `npx expo start` alone. Metro also serves the built UI to the WebView, because Expo Go cannot carry the local server. The local server stays for the real app, and an offline Android build must pass before the first release is complete. See [Expo Go Development Mode](#expo-go-development-mode).

## Technical Context

**Language/Version**: TypeScript. WebView code uses Desktop's TypeScript 5.9 and React 18.3.1; the host uses TypeScript ~6.0.3, React 19.2.3, React Native 0.86, Expo 57.

**Primary Dependencies**: Existing: Vite 8, Tailwind 4, epub.js, PDF.js 5.4.624, zustand, `book-reader-sdk`. New for Mobile: `react-native-webview`, `expo-sqlite`, `expo-file-system`, `expo-document-picker`, plus a local file server chosen at M2 ([research.md](./research.md) R2). Each gets a decision record (FR-030).

**Storage**: Host SQLite through `expo-sqlite`, with a Mobile baseline schema that follows Desktop's data contract. Book copies and covers in app-private storage. Preferences stay in WebView `localStorage`, subject to a durability check.

**Testing**: Existing SDK vitest suite. New vitest suite for the bridge and stores in the Mobile workspace, on Node's `node:sqlite`. Contract fixtures. Boundary checks. Manual device journey ([quickstart.md](./quickstart.md)). Desktop checks as in CLAUDE.md; E2E only when the user asks.

**Target Platform**: Android (minimum recorded at M2) and iOS 18.2+. Development uses Expo Go. The real app needs a native Android build, because Expo Go cannot carry the local server; that build is deferred until UI and bridge development are finished (FR-017l). M0 to M5 need no Mac.

**Project Type**: Mobile host app that reuses a web UI, within the existing npm-workspaces monorepo.

**Performance Goals**: Working targets to confirm at M2: a 100 MB PDF and a 100 MB EPUB open on the reference Android device without a WebView crash; a bridge call without file bytes returns within 100 ms. The final book size limit is recorded after measurement.

**Constraints**: Offline; no book file writes; no Desktop schema, IPC or `npm run dev` change; no bulk Desktop refactor; no new SDK; no copied UI; one lockfile as the target.

**Scale/Scope**: About 32 bridge methods implemented out of the much larger `DesktopApi`; the rest answer "not available" or a safe empty result ([contracts/mobile-bridge.md](./contracts/mobile-bridge.md)).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so it defines no gates. The spec's constraints are used instead.

| Gate (source) | Before research | After design |
|---|---|---|
| Desktop unchanged, `npm run dev` works (FR-010, FR-013) | Pass | Pass: Desktop gets additive files and CSS only; one exit check per milestone |
| No new shared SDK (FR-009) | Pass | Pass: bridge code lives in the Mobile app |
| No copied UI (FR-016) | Pass | Pass: Vite build reads `src/` directly |
| No Electron runtime in the Mobile build (FR-015) | Pass | **Exception**: see Complexity Tracking |
| No book file writes (FR-017d) | Pass | Pass: host file service has no write route for book copies after import |
| One lockfile (FR-017e) | Pass | Pass: `source/package-lock.json` already covers Mobile |
| Unresolved clarifications | None | None; measured values are gated at M2 |
| Offline release path kept (FR-016, FR-017l) | Pass | Pass: the Expo Go route needs `__DEV__` and Expo Go together, so a release build always uses the local server |
| `npx expo start` alone (FR-017k) | Pass | Pass by design; startup and the host bundle tested on 2026-11-02 with a temporary link. UI serving is not yet run |

## Project Structure

### Documentation (this feature)

```text
specs/008-shared-core-architecture/
├── spec.md
├── architecture-audit.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── mobile-bridge.md
│   ├── host-services.md
│   └── phone-ui.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks, not created here
```

### Source Code

```text
source/apps/reading-book-mobile/
├── src/app/                 # Expo Router: one route holding the WebView
├── src/host/                # host services + RPC dispatcher (React Native); ui-source.ts picks the UI route
├── modules/                 # in-repo local server; loaded only outside Expo Go
├── scripts/link-expo-root.mjs  # postinstall: makes `expo` resolvable from source/node_modules
├── scripts/ui-middleware.cjs   # Metro middleware serving web/dist at /readmate-ui/ (development only)
├── web/
│   ├── index.html           # no remote fonts; strict CSP
│   ├── vite.config.ts       # no Electron plugin; root here, source from Desktop
│   ├── src/main.ts          # installs window.api, then loads Desktop's src/main.tsx
│   ├── src/bridge/          # DesktopApi implementation, per feature
│   ├── src/stores/          # SQL stores against the data contract
│   ├── src/db/              # baseline schema, migration runner
│   └── tests/               # vitest on node:sqlite
└── app.json, metro.config.js, babel.config.js   # config fixes

source/apps/reading-book-desktop/src/   # additive, plus FR-012c steps
├── platform/                # signal + capability helper (Electron: unchanged results)
├── styles/phone.css         # rules below 900 px
├── screens/ReaderRoute.tsx  # Mobile signal → lazy MobileReaderScreen; Electron → ReaderScreen, as today
└── screens/Reader/
    ├── ReaderScreen.tsx     # Desktop Reader; loses wiring step by step, behaviour unchanged
    ├── logic/reader-core/   # wiring moved out of ReaderScreen, used by both Readers (FR-012c)
    └── phone/               # Mobile Reader UI: screen, bottom bar, sheets, touch menus

source/apps/book-reader-sdk/tests/contracts/   # fixtures shared by both apps
```

**Structure Decision** (spec 008; superseded by spec 009, which moved everything into one project, see the table at the top): Keep the current workspaces; move nothing. The WebView code lives in `reading-book-mobile/web`, as Mobile's own code, and takes the Desktop UI as build input.

## macOS and iOS Compatibility Rules

The code is written for iOS and for development on a MacBook from M1 onward (FR-017j). **Testing there is a separate task** (OD-11), so these rules are unproven until then.

| Area | Rule | Checked now by |
|---|---|---|
| Scripts | New scripts are Node `.mjs` or plain npm commands: no PowerShell, `cmd`, or Windows paths. Use `path.join` and `/` in config | Review; CI on Ubuntu runs the web build |
| File names | Import paths match file names exactly, since other systems may be case-sensitive | CI on Ubuntu |
| Expo config | `app.json` sets `ios.bundleIdentifier` and the built-in `ios.deploymentTarget` of `18.2` (SDK 56+; the `expo-build-properties` option is deprecated) | `npx expo config` |
| Generated folders | `/ios` and `/android` stay git-ignored and are generated by prebuild; all native settings live in `app.json` and config plugins | `.gitignore`; prebuild on iOS in the later task |
| Native dependencies | Each decision record must confirm iOS support and Apple-silicon builds. A dependency that lacks either is rejected. This applies to the local server | Decision record |
| In-repo native code | If an Expo module is written, its iOS (Swift) and Android (Kotlin) sides land together. Swift cannot be compiled on Windows, so it is marked untested until the later task | Marked in the task |
| WebView code | No Chromium-only behaviour in phone code. WebKit differences (selection, callouts, memory limits) are feature-checked | Web standards review; WebKit run below |
| Transport | iOS and Android loopback rules are both configured. Android 9+ blocks cleartext by default, so `127.0.0.1` needs a narrow network rule, not global cleartext | Android at M2 |
| Files | Only relative paths are stored, because iOS can change the container path after an update. `files.pick` uses copy-to-cache on both | Mobile tests |
| Early WebKit check | Run the Mobile web build in Playwright WebKit on Windows, with a fake host, as an early warning for WebKit problems. **Not a substitute for iOS** | Added to M2 |

## Expo Go Development Mode

Details and evidence are in [research.md](./research.md) R10 to R14.

| Part | Decision |
|---|---|
| Metro startup | A Mobile `postinstall` links `source/node_modules/expo` to Mobile's `expo`, because the hoisted `@expo/metro-config` must resolve it. Portable: a junction on Windows, a symlink elsewhere |
| UI source | `npm run build:web` writes `web/dist`. A middleware in `metro.config.js` serves it at `/readmate-ui/`, so no second process or port is needed |
| Host | `src/host/ui-source.ts` uses `http://{hostUri}/readmate-ui/index.html` when `__DEV__` and Expo Go both hold, otherwise the local server. `modules/local-server` is required only on the second path |
| Non-secure page | `web/src/main.ts` provides `crypto.randomUUID` and a safe `navigator.clipboard` when the browser lacks them. This is Mobile code, so Desktop does not change |
| Book bytes | The local server is the real route. In Expo Go only, `files.readChunk` sends base64 chunks, up to a 20 MB working limit, and a larger book shows a clear message |
| UI changes | Rerun `npm run build:web` and reload, or keep `npm run dev:web` (`vite build --watch`) running. There is no hot reload of the UI in this mode |

**Provisional M2 on Expo Go (FR-017m)**:

| Check | Where |
|---|---|
| 4 formats render, page turns, text selection, PDF.js worker, SQLite and JSON functions | Expo Go |
| `file://` result (T017), local server, offline start, 100 MB books, `localStorage` after a restart, final Android minimum | Android build; recorded as **unverified** until then |

## Milestones and Exit Checks

| Step | Work | Exit |
|---|---|---|
| **M0** | Settle the 2 failing gate tests (user decision); record baseline; correct docs; mark spec 003 | SC-001 baseline, SC-008 |
| **M1** | Remove stale Desktop and Mobile lockfiles after a clean `npm ci`; list nested exceptions; remove the stale Babel alias; fix Metro for workspaces; add the web build | SC-011; Desktop checks and `npm run dev` pass |
| **M2** | Expo Go mode, then feasibility in Expo Go: UI, epub.js, PDF.js, workers, selection, SQLite | `npx expo start` shows the UI on a phone; provisional pass with unverified items listed; **stop and report if a format fails** |
| **M3** | Boundary checks; contract fixtures; `sql-notes` flagged | SC-003, SC-006 |
| **M4** | Host services, bridge, stores, import, remove | SC-010 |
| **M5** | Phone CSS, capability gating, touch replacements, in Expo Go. Reader: touch spikes first, then FR-012c steps, then the Mobile Reader UI (`contracts/phone-ui.md`). Then the deferred Android build: find and fix the build failure, run the unverified M2 items and the offline journey | SC-002, SC-004 Android, OD-10 finally closed |
| **M6 (separate task)** | Docker test environment and any Mac setup (OD-11); recheck M2 points; fix iOS findings; full journey | SC-004 iOS; first release complete |

`/speckit-tasks` for this plan covers M0 to M5 with the compatibility rules above. M5 ends with "iOS-ready, not iOS-tested".

M2 comes before any bridge work because its result can change the design at the lowest cost.

## Open Decisions Closed by This Plan

| OD | Result |
|---|---|
| OD-1, OD-5 | The host does not import the SDK in the first release, so Hermes behaviour does not apply |
| OD-2 | New stores in `web/src/stores`, reusing SDK pure rules; SDK `services/*` not adopted; `sql-notes` not used |
| OD-3 | Separate Mobile baseline, contract-tested |
| OD-6 | Host `sql.transaction` runs a statement batch atomically |
| OD-7 | Out of the first release |
| OD-8 | Mobile stores test on `node:sqlite`; Desktop stores against fixtures through a local Electron-ABI script, as existing spikes do |

Still open: OD-4 closes at M2; OD-10 closes provisionally at M2 and finally on the Android build; OD-9 at M0; OD-11 before M6.

## Risks Specific to This Design

| Risk | Handling |
|---|---|
| Whole books are loaded into WebView memory, as on Desktop (`ArrayBuffer`) | M2 measurement, then a size limit |
| Stores run in the WebView, which the OS can kill | Every save is one atomic host call; UI reloads and reads from SQLite |
| Stores reimplement parts of 3,015 lines of Desktop persistence | Contract fixtures and one conformance suite for both sides |
| Phone UI work may be much larger than CSS, as `ReaderScreen.tsx` has 2,021 lines | Reviewed at M2 (T024): additive changes cannot deliver the Reader. The user chose a separate Mobile Reader UI (2026-11-03); risks and checks in `contracts/phone-ui.md` |
| iOS problems surface only at M6, after the code is written | Compatibility rules and the WebKit run reduce this, but cannot remove it; iOS fixes may reach bridge and CSS code |
| Local server exposes data on loopback | Per-launch token on book and cover routes, GET only, loopback only |
| Expo Go hides problems that only the real build has: memory, the local server, `localStorage`, native build failures | Listed as unverified (FR-017m). Late failures may reopen bridge work, and the user accepted this risk |
| The Android build failure is still undiagnosed | No APK exists and the cause is unknown. It is deferred, not solved, and it blocks the first release |
| The Metro middleware shows the built UI to the local network during development | Development only, GET only, `web/dist` only, path traversal refused. Metro already serves source bundles on the same network |
| `source/node_modules/expo` link may affect Desktop, or disappear after an install | No Desktop code imports `expo`. Rerun Desktop checks and a Desktop package after adding it. `postinstall` recreates the link |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| FR-015: `src/reader/renderers/pdf/typewriterFonts.ts` imports `electron/pdf-sync/pdf-font-embed.ts` at runtime | That module's only import is type-only, so it needs no Electron or Node. The boundary check lists this one file as an allowed exception | Moving it to the SDK is a Desktop refactor Mobile does not need, since Typewriter is hidden on Mobile |
| New web build alongside Metro | The UI is web code and Metro builds the host | Bundling the UI with Metro would mean replacing Vite-specific code (`?url`, `import.meta.glob`) in Desktop |
| Two UI routes and two book-byte routes (Expo Go, local server) | The user chose Expo Go for development, and it cannot carry the local server | A development build was tried and has not succeeded. Using a build-only flow would block daily work |
| Base64 book chunks over `postMessage` in Expo Go (allowed by FR-017b, development only) | Expo Go has no other route from app storage to the WebView | A server on the computer cannot read files stored on the phone. The route is development-only and size-capped |
| A generated link in `source/node_modules` | npm hoists `@expo/metro-config` but cannot hoist `expo`, and `npx expo start` must work with no environment variable | `NODE_PATH` works, but not for plain `npx expo start`; a root `expo` dependency would resolve Desktop's React 18 |
