# Readmate Mobile (`reading-book-mobile`)

The phone app is a thin React Native host around a WebView. The WebView runs the **same React UI as Desktop**
(`reading-book-desktop/src/`), built for the browser by Vite, with a Mobile implementation of `window.api` (the
"Mobile Bridge") in place of Electron's preload + IPC. Spec: `specs/008-shared-core-architecture/` (architecture and
contracts); feature map: `docs/implementation_plan/mobile_webview.md`.

```
React Native host (src/)                         WebView (web/ + reading-book-desktop/src/)
├── app/index.tsx      WebView, boot values      ├── web/src/main.ts        sets __READMATE_HOST__, builds window.api,
├── host/rpc.ts        host-services dispatcher  │                          then imports Desktop's src/main.tsx
├── host/sql-service   expo-sqlite (sql.*)       ├── web/src/bridge/*       window.api groups (library, overlay, import,
├── host/file-service  picker, staging, books/   │                          txt, app); unavailable.ts for the rest
├── host/app-service   app.info, system bars …   ├── web/src/stores/*       SQLite stores on the host's sql.* service
└── host/local-server  starts modules/local-server├── web/src/db/*           Mobile schema baseline + migrations
                                                 └── reading-book-desktop/src  screens, renderers, stores (unchanged;
modules/local-server/  Kotlin + Swift loopback                                  phone branches behind isMobileHost())
                       HTTP server (UI + book bytes)
plugins/with-loopback-cleartext.js   release builds allow cleartext to 127.0.0.1 only
```

- **One channel for messages, one for bytes.** Small JSON requests go over `postMessage` (`contracts/host-services.md`);
  book bytes and covers come from the loopback server on `127.0.0.1` with a per-launch token (`decisions/local-file-server.md`).
  No real file path ever reaches the UI.
- **Copy-based library.** An imported book is copied into app storage (`books/{uuid}/file`); the user's file is never
  referenced or written.
- **First release**: EPUB, PDF, TXT (read-only), Markdown; bookmarks, highlights and notes; reading position and
  appearance. Cloud, URL import, audiobooks, annotation transfer, search, translation, read aloud and PDF tools are
  hidden on the phone and answer `NOT_AVAILABLE_ON_PLATFORM` in the bridge (`contracts/mobile-bridge.md`).
- **Phone UI**: Library and Settings are Desktop's screens with phone CSS (`src/styles/phone.css`) and small branches;
  the Reader is a separate Mobile Reader (`src/screens/Reader/phone/`) on the same core hooks
  (`contracts/phone-ui.md`).

## Commands (from this folder)

| Command | What |
|---|---|
| `npm run build:web` | Build the WebView UI into `web/dist` (Vite; pdf.js legacy build on Mobile) |
| `npm run dev:web` | Same, watching |
| `npm start` | `expo start` — Expo Go: the UI comes from Metro over the LAN, books in 1 MiB chunks (≤ 20 MB per book). Development only |
| `npm run android` | `expo run:android` — the native build with the local server (needs the Android SDK and JDK 17+) |
| `npm run typecheck`, `npm run typecheck:web` | Host and WebView TypeScript |
| `npm test` | vitest: host services, bridge, stores, migrations against Desktop's contract fixtures |
| `npm run lint` | ESLint |

From `source/`: `npm run check:boundaries` checks the dependency rules (SDK imports, app imports, Mobile UI bundle
graph, workspace graph, no secrets in bundles).

## Android build notes (Windows)

- Build one or two ABIs while developing: `cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64`.
  With all four ABIs and parallel Gradle, CMake/ninja on Windows can fail with `manifest 'build.ninja' still dirty after
  100 tries` or a locked `*_timing.txt`; `--no-parallel` avoids both (see `specs/008-shared-core-architecture/m5-results.md`).
- Kotlin unit tests of the local server: `./gradlew :local-server:testDebugUnitTest`.
- Kotlin sources must not contain a lone carriage return inside a string literal (Windows editors can insert one before
  an escaped `\r\n`); the compiler then reports `Expecting '"'`.

## iOS

The Swift side of the local server and every host module are written for iOS, but nothing has been built or run on iOS
yet (M6, a separate task). What is unproven is listed in `specs/008-shared-core-architecture/ios-readiness.md`.
