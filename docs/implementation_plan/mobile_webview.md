# Mobile app: the desktop UI in a WebView (spec 008)

Map of where the Mobile app's parts live and how a new capability is placed. The authority is
`specs/008-shared-core-architecture/` (spec: responsibility matrix and dependency rules; contracts: `mobile-bridge.md`,
`host-services.md`, `phone-ui.md`; decisions: `decisions/`). This file only points at it.

## Shape

```
┌──────────── React Native host — source/apps/reading-book-mobile/src ────────────┐
│ app/index.tsx            WebView, boot values (token, baseUrl, platform)        │
│ host/rpc.ts              dispatcher of host services (JSON over postMessage)   │
│ host/sql-service.ts      sql.query / run / transaction  (expo-sqlite)          │
│ host/file-service.ts     files.pick / stage / hashStaged / commitStaged / …     │
│ host/app-service.ts      app.info / boot / setSystemBars / openExternal         │
│ host/lifecycle.ts        background → flush event                              │
│ modules/local-server/    Kotlin + Swift loopback HTTP server (UI, books, covers)│
└──────────────────────────────────┬──────────────────────────────────────────────┘
                 postMessage (JSON only)│      HTTP 127.0.0.1 + per-launch token (bytes)
┌──────────────────────────────────┴──── WebView — reading-book-mobile/web ────────┐
│ web/src/main.ts          __READMATE_HOST__ = 'mobile'; window.api; import ↓     │
│ web/src/bridge/*         Mobile Bridge = window.api (type: Desktop's DesktopApi)│
│ web/src/stores/*         library / overlay stores on host SQL                    │
│ web/src/db/*             Mobile schema baseline + migrations (OD-3)              │
│ ───────────────────────── reading-book-desktop/src (not copied) ──────────────── │
│ screens, components, renderers, zustand stores, src/bridge/* — unchanged        │
│ src/platform/            isMobileHost(), isFeatureAvailable(), long-press       │
│ src/styles/phone.css     phone rules under [data-mobile-host]                   │
│ src/chrome/PhoneNav.tsx  replaces the titlebar + menubar                        │
│ src/screens/Reader/phone Mobile Reader (lazy), on reader-core hooks             │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Feature map

| Feature | Where (Mobile-specific part) | Shared with Desktop | Contract / record |
|---|---|---|---|
| Boot, `window.api` | `web/src/main.ts`, `web/src/bridge/index.ts` | Desktop's `src/main.tsx` | `mobile-bridge.md` |
| Library list, metadata, collections | `web/src/bridge/library.ts`, `web/src/stores/library-store.ts` | Library screens, `libraryStore` | `mobile-bridge.md`, contract fixtures |
| Import (copy-based) | `web/src/bridge/import.ts`, `src/host/file-service.ts`, `expo-host-fs.ts` | Import menu ("Add file" only) | `host-services.md`, `data-model.md` (Import job) |
| Remove book | `library.removeBook` in the bridge, `files.removeBook`, startup `files.sweep` | Book menu | `data-model.md` (Removal) |
| Book bytes, covers | `modules/local-server/`, `web/src/bridge/book-content.ts`; Expo Go: `files.readChunk` | `openBookContent` callers | `decisions/local-file-server.md` |
| Reading position, per-book prefs | `web/src/bridge/overlay.ts` (`getSessionState`, `saveSessionState`) | `useReaderSessionBridge`, autosave | contract fixtures (`reading_state_json`) |
| Bookmarks, highlights, notes | `web/src/stores/overlay-store.ts` | highlight stores, `useReaderAnnotations` | contract fixtures (`note_json`) |
| TXT (read-only) | `web/src/bridge/txt.ts` (`editable: false`) | `useReaderTxt`, TXT renderer | `mobile-bridge.md` |
| Mobile Reader | `src/screens/Reader/phone/` | `reader-core/` (`useReaderCore`, `useReaderAnnotations`, derivations), renderers | `phone-ui.md` "Mobile Reader UI" |
| Phone layout of other screens | `src/styles/phone.css`, phone branches behind `isMobileHost()` | the screens themselves | `phone-ui.md` |
| Hidden features | `isFeatureAvailable()` (`src/platform/index.ts`), `capabilities.ts` | — | `phone-ui.md` Gating |
| Not-available methods | `web/src/bridge/unavailable.ts` | — | `mobile-bridge.md` "Not available" |
| Status / navigation bar colours | `web/src/bridge/system-bars.ts`, `app.setSystemBars` | theme | `host-services.md` |
| Dependency rules | `source/scripts/boundaries/` (`npm run check:boundaries`) | — | spec "Dependency Rules" R1–R11 |
| New Mobile native dependency | `specs/008-shared-core-architecture/decisions/` (`TEMPLATE.md`) | — | FR-030 |

## Rules that decide placement

1. A rule about the meaning of data (dedupe, positions, annotation geometry, text offsets) belongs in
   `book-reader-sdk/src`, never in a host. Both apps call it.
2. UI (screens, components, CSS, UI stores, renderers) belongs in `reading-book-desktop/src`, never in Mobile. A phone
   difference is a branch behind `isMobileHost()` or a rule in `phone.css`; the Reader's phone chrome is
   `screens/Reader/phone/`, which only calls shared hooks.
3. A `window.api` method is implemented twice: Desktop in `electron/ipc` + preload, Mobile in `web/src/bridge`. Same DTOs,
   same error shapes. Mobile without it answers `NOT_AVAILABLE_ON_PLATFORM` and the UI hides the entry.
4. Anything that touches a file, a driver or the OS on Mobile is a host service (`src/host/*`), with validated ids and
   no paths from the WebView. Bytes go through the local server, never through `postMessage`.
5. Stored data shapes are fixed by the contract fixtures (`book-reader-sdk/tests/contracts/`); each app's store
   conforms to them. Schemas are per app (OD-3).

## Placement exercise (SC-007)

Ten capabilities, placed with the spec's responsibility matrix alone. Each answer cites the matrix row it follows.

| # | Capability | Placement | Matrix row |
|---|---|---|---|
| 1 | Show a "Recently added" shelf in the Library | `reading-book-desktop/src/screens/Library` (one component for both apps); data from the existing `library.listBooks` | "Screens, components, CSS, UI stores": Desktop owns `src/`, Mobile reuses it |
| 2 | Decide whether two imported files are the same book | SDK rule (hash comparison), called by Desktop's import and by the Mobile bridge's import | "Library rules: dedupe, collections": must match Desktop |
| 3 | Store a new per-book reading preference (for example paragraph spacing) | Default + model in the SDK; saved inside `reading_state_json` by both stores; new key added to the contract fixtures | "Reading-state logic" + "Stored data shapes" |
| 4 | Turn pages by swiping on the phone | `src/screens/Reader/phone/` (touch handling), on the shared `nav.switchPage` | "Selection and gesture handling": DOM, touch on Mobile; never in the core |
| 5 | Open a PDF's embedded attachment on the phone | Not in the first release: bridge answers `NOT_AVAILABLE_ON_PLATFORM`, the tab is hidden via capabilities | "PDF write-back to file" / formats beyond the first release (`mobile-bridge.md` "Not available") |
| 6 | Read the free space left on the device before an import | Host service (`files.stage` checks `availableBytes`) | "SQLite driver, file access": never in the core; host modules |
| 7 | Sign in to Google Drive from the phone | Not in the first release (OD-7); later a Mobile host client, never `host-adapters` | "Cloud clients, OAuth": Mobile own, OD-7 |
| 8 | Compare two EPUB CFIs to sort highlights | SDK (`cfi`) | "EPUB CFI strings, comparison": shared core owns |
| 9 | Choose the app's accent colour | Default in `packages/config` / SDK prefs model; stored by the existing Appearance store in `localStorage` | "App preferences storage" + "Formats, flags, redirect constants" |
| 10 | Count words in a book | Not on Mobile in the first release (bridge `wordCount` not available, toolbar tool removed); text rules stay in the SDK | "Text search rules, chunking": shared rules; Mobile [INVESTIGATE] |

Checked against `spec.md` "Shared vs Platform-Specific Responsibility Matrix" on 2026-11-05: each answer follows the
cited row, and items 5, 7 and 10 also match `contracts/mobile-bridge.md` "Not available" and `contracts/phone-ui.md`
Gating. The exercise has not yet been given to a second developer, so SC-007 is not measured.

## Checks

| What | Command |
|---|---|
| Dependency rules | `cd source && npm run check:boundaries` |
| Mobile host + WebView types | `cd source/apps/reading-book-mobile && npm run typecheck && npm run typecheck:web` |
| Bridge, host services, stores, contract fixtures | `npm test` (Mobile), `npm test` (SDK, `tests/contracts/`) |
| WebView build | `npm run build:web` |
| Local server (Kotlin) | `cd android && ./gradlew :local-server:testDebugUnitTest` |
| Device journey | `specs/008-shared-core-architecture/quickstart.md` section 5 (needs a phone) |
