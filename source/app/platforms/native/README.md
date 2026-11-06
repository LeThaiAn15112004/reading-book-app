# Readmate Mobile (`source/app/platforms/native`)

The phone app is a thin React Native host around a WebView. The WebView runs the **same React UI as Desktop**
(`source/app/`), built for the browser by Vite, with a Mobile implementation of `window.api` (the
"Mobile Bridge") in place of Electron's preload + IPC. Spec: `specs/008-shared-core-architecture/` (architecture and
contracts); feature map: `docs/implementation_plan/mobile_webview.md`.

```
React Native host (this folder)                  WebView (this folder + source/app/)
├── routes/index.tsx   WebView, boot values      ├── main.ts                sets __READMATE_HOST__, builds window.api
├── host/rpc.ts        host-services dispatcher  │                          (create-api.ts), then imports @app/main
├── host/sql-service   expo-sqlite (sql.*)       ├── bridge/*               window.api groups (library, overlay, import,
├── host/file-service  picker, staging, books/   │                          txt, app); unavailable.ts for the rest
├── host/app-service   app.info, system bars …   ├── stores/*               SQLite stores on the host's sql.* service
└── host/local-server  starts modules/local-server├── db/*                   Mobile schema baseline + migrations
                                                 └── source/app (screens, components, hooks: unchanged;
                                                       phone branches behind isMobileHost())
modules/local-server/  Kotlin + Swift loopback
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
- **Phone UI**: Library and Settings are Desktop's screens with phone CSS (`source/app/styles/phone.css`) and small branches;
  the Reader is a separate Mobile Reader (`source/app/screens/Reader/phone/`) on the same core hooks
  (`contracts/phone-ui.md`).

## Commands (from the repository root)

| Command | What |
|---|---|
| `npm run build:web` | Build the WebView UI into `web-dist/` (Vite, `vite.native.config.ts`; pdf.js legacy build on Mobile) |
| `npm run dev:web` | Same, watching |
| `npm run dev:mobile` | `expo start` — Expo Go: the UI comes from Metro over the LAN, books in 1 MiB chunks (≤ 20 MB per book). Development only |
| `npm run android` | `expo run:android` — the native build with the local server (needs the Android SDK and JDK 17+) |
| `npm run mobile:typecheck`, `npm run mobile:typecheck:web` | Host and WebView TypeScript |
| `npm run mobile:test` | vitest: host services, bridge, stores, migrations against Desktop's contract fixtures |
| `npm run mobile:lint` | ESLint (this folder keeps its own Expo config) |

Also: `npm run check:boundaries` (dependency rules R1–R3, R5–R9, R11, R12), `npm run check:build-split`.

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
