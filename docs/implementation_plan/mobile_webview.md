# Mobile app: the desktop UI in a WebView (spec 008)

Map of where the Mobile app's parts live and how a new capability is placed. The authority is
`specs/008-shared-core-architecture/` (spec: responsibility matrix and dependency rules; contracts: `mobile-bridge.md`,
`host-services.md`, `phone-ui.md`; decisions: `decisions/`). This file only points at it.

Paths follow spec 009 (one project, `specs/009-single-project-monorepo/`): the Mobile host is
`source/app/platforms/native`, the shared UI is `source/app`, the shared core is `source/core`. Everything runs from the
repository root.

## Shape

```
┌──────── React Native host — source/app/platforms/native ─────────────────────────┐
│ routes/index.tsx         WebView, boot values (token, baseUrl, platform)        │
│ host/rpc.ts              dispatcher of host services (JSON over postMessage)   │
│ host/sql-service.ts      sql.query / run / transaction  (expo-sqlite)          │
│ host/file-service.ts     files.pick / stage / hashStaged / commitStaged / …     │
│ host/app-service.ts      app.info / boot / setSystemBars / openExternal         │
│ host/lifecycle.ts        background → flush event                              │
│ modules/local-server/    Kotlin + Swift loopback HTTP server (UI, books, covers)│
└──────────────────────────────────┬──────────────────────────────────────────────┘
                 postMessage (JSON only)│      HTTP 127.0.0.1 + per-launch token (bytes)
┌──────────────────────────────────┴──── WebView — vite.native.config.ts ──────────┐
│ native/main.ts           __READMATE_HOST__ = 'mobile'; api; import @app/main    │
│ native/create-api.ts     builds the Mobile api (type: Desktop's Window['api'])  │
│ native/bridge/*          Mobile Bridge groups (library, overlay, import, txt …)  │
│ native/stores/*          library / overlay stores on host SQL                    │
│ native/db/*              Mobile schema baseline + migrations (OD-3)              │
│ ───────────────────────── source/app (shared, not copied) ─────────────────────── │
│ screens, components, renderers, zustand stores, bridge/* — unchanged            │
│ platforms/*.native.ts    host, longPress, api, storage, window (adapters)        │
│ styles/phone.css         phone rules under [data-mobile-host]                   │
│ components/chrome/PhoneNav.tsx  replaces the titlebar + menubar                 │
│ screens/Reader/phone     Mobile Reader (lazy), on reader-core hooks             │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Below, `native/` = `source/app/platforms/native/`, `app/` = `source/app/`, `core/` = `source/core/`.

## Feature map

| Feature | Where (Mobile-specific part) | Shared with Desktop | Contract / record |
|---|---|---|---|
| Boot, `api` | `native/main.ts`, `native/create-api.ts`, `app/platforms/api.native.ts` | `app/main.tsx` | `mobile-bridge.md`, spec 009 `contracts/platform-adapters.md` |
| Library list, metadata, collections | `native/bridge/library.ts`, `native/stores/library-store.ts` | Library screens, `libraryStore`; SQL in `core/src/db/library` | `mobile-bridge.md`, contract fixtures |
| Import (copy-based) | `native/bridge/import.ts`, `native/host/file-service.ts`, `native/host/expo-host-fs.ts` | Import menu ("Add file" only) | `host-services.md`, `data-model.md` (Import job) |
| Remove book | `library.removeBook` in the bridge, `files.removeBook`, startup `files.sweep` | Book menu | `data-model.md` (Removal) |
| Book bytes, covers | `native/modules/local-server/`, `native/bridge/book-content.ts`, `app/platforms/storage.native.ts`; Expo Go: `files.readChunk` | `openBookContent` callers | `decisions/local-file-server.md` |
| Reading position, per-book prefs | `native/bridge/overlay.ts` (`getSessionState`, `saveSessionState`) | `useReaderSessionBridge`, autosave | contract fixtures (`reading_state_json`) |
| Bookmarks, highlights, notes | `native/stores/overlay-store.ts` (SQL in `core/src/db/overlay`) | highlight stores, `useReaderAnnotations` | contract fixtures (`note_json`) |
| TXT (read-only) | `native/bridge/txt.ts` (`editable: false`) | `useReaderTxt`, TXT renderer | `mobile-bridge.md` |
| Mobile Reader | `app/screens/Reader/phone/` | `reader-core/` (`useReaderCore`, `useReaderAnnotations`, derivations), renderers | `phone-ui.md` "Mobile Reader UI" |
| Phone layout of other screens | `app/styles/phone.css`, phone branches behind `isMobileHost()` | the screens themselves | `phone-ui.md` |
| Hidden features | `isFeatureAvailable()` (`app/platforms/host.native.ts`), `app/components/reader/capabilities.ts` | — | `phone-ui.md` Gating |
| Not-available methods | `native/bridge/unavailable.ts` | — | `mobile-bridge.md` "Not available" |
| Status / navigation bar colours | `app/platforms/window.native.ts`, `app.setSystemBars` | theme | `host-services.md` |
| Dependency rules | `source/scripts/boundaries/` (`npm run check:boundaries`), `npm run check:build-split` | — | spec 009 `contracts/dependency-rules.md` (R1–R3, R5–R9, R11, R12) |
| New Mobile native dependency | `specs/008-shared-core-architecture/decisions/` (`TEMPLATE.md`) | — | FR-030 |

## Rules that decide placement

1. A rule about the meaning of data (dedupe, positions, annotation geometry, text offsets) belongs in
   `source/core/src`, never in a host. Both apps call it. Shared SQL statements and codecs live in `source/core/src/db`.
2. UI (screens, components, CSS, UI stores, renderers) belongs in `source/app`, never in the Mobile host. A phone
   difference is a platform adapter (`source/app/platforms/<concern>.native.ts`), a branch behind `isMobileHost()` or
   a rule in `phone.css`; the Reader's phone chrome is `screens/Reader/phone/`, which only calls shared hooks.
3. A `window.api` method is implemented twice: Desktop in `platforms/electron/ipc` + preload, Mobile in
   `platforms/native/bridge`. Same DTOs, same error shapes. Mobile without it answers `NOT_AVAILABLE_ON_PLATFORM` and
   the UI hides the entry.
4. Anything that touches a file, a driver or the OS on Mobile is a host service (`platforms/native/host/*`), with
   validated ids and no paths from the WebView. Bytes go through the local server, never through `postMessage`.
5. Stored data shapes are fixed by the contract fixtures (`source/core/tests/contracts/`); each app's store
   conforms to them. Schemas are per app (OD-3).

## Placement exercise (SC-007)

Ten capabilities, placed with the spec's responsibility matrix alone. Each answer cites the matrix row it follows.

| # | Capability | Placement | Matrix row |
|---|---|---|---|
| 1 | Show a "Recently added" shelf in the Library | `source/app/screens/Library` (one component for both apps); data from the existing `library.listBooks` | "Screens, components, CSS, UI stores": the shared UI `source/app`, both hosts use it |
| 2 | Decide whether two imported files are the same book | SDK rule (hash comparison), called by Desktop's import and by the Mobile bridge's import | "Library rules: dedupe, collections": must match Desktop |
| 3 | Store a new per-book reading preference (for example paragraph spacing) | Default + model in the SDK; saved inside `reading_state_json` by both stores; new key added to the contract fixtures | "Reading-state logic" + "Stored data shapes" |
| 4 | Turn pages by swiping on the phone | `source/app/screens/Reader/phone/` (touch handling), on the shared `nav.switchPage` | "Selection and gesture handling": DOM, touch on Mobile; never in the core |
| 5 | Open a PDF's embedded attachment on the phone | Not in the first release: bridge answers `NOT_AVAILABLE_ON_PLATFORM`, the tab is hidden via capabilities | "PDF write-back to file" / formats beyond the first release (`mobile-bridge.md` "Not available") |
| 6 | Read the free space left on the device before an import | Host service (`files.stage` checks `availableBytes`) | "SQLite driver, file access": never in the core; host modules |
| 7 | Sign in to Google Drive from the phone | Not in the first release (OD-7); later a Mobile host client, never `host-adapters` | "Cloud clients, OAuth": Mobile own, OD-7 |
| 8 | Compare two EPUB CFIs to sort highlights | SDK (`cfi`) | "EPUB CFI strings, comparison": shared core owns |
| 9 | Choose the app's accent colour | Default in `source/core/src/config` / core prefs model; stored by the existing Appearance store in `localStorage` | "App preferences storage" + "Formats, flags, redirect constants" |
| 10 | Count words in a book | Not on Mobile in the first release (bridge `wordCount` not available, toolbar tool removed); text rules stay in the SDK | "Text search rules, chunking": shared rules; Mobile [INVESTIGATE] |

Checked against `spec.md` "Shared vs Platform-Specific Responsibility Matrix" on 2026-11-05: each answer follows the
cited row, and items 5, 7 and 10 also match `contracts/mobile-bridge.md` "Not available" and `contracts/phone-ui.md`
Gating. The exercise has not yet been given to a second developer, so SC-007 is not measured.

## Checks

All from the repository root.

| What | Command |
|---|---|
| Dependency rules, build split | `npm run check:boundaries`, `npm run check:build-split` |
| Mobile host + WebView types | `npm run mobile:typecheck && npm run mobile:typecheck:web` |
| Bridge, host services, stores, contract fixtures | `npm run mobile:test`, `npm run sdk:test` (`source/core/tests/contracts/`) |
| WebView build | `npm run build:web` |
| Everything above + Desktop | `npm run check` |
| Local server (Kotlin) | `cd android && ./gradlew :local-server:testDebugUnitTest` |
| Android APK | `npm run android` (or `cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64 --no-parallel`) |
| Device journey | `specs/008-shared-core-architecture/quickstart.md` section 5 (needs a phone) |
