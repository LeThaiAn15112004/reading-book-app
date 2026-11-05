# M2 Results (provisional, FR-017m)

**Date**: 2026-11-03 | **Environment**: Windows, Node 22.13.0, Expo 57, Wi-Fi address 192.168.1.235

**No real phone has opened the app yet; BlueStacks has.** Everything below ran on the computer, unless a row says otherwise.

## Expo Go mode, on the computer (T089)

| Check | Result |
|---|---|
| `npx expo start` with no environment variable | Starts |
| Host bundle, Android and iOS, through Metro and `npx expo export` | Pass; one React 19.2.3 in the bundle |
| `/readmate-ui/index.html` and assets | 200 with correct MIME |
| Missing file, `../` and `..%2f` paths | 404 |
| `POST` | 405 |
| Address Expo picks on this machine, which also has Radmin VPN | 192.168.1.235 (Wi-Fi), not the VPN address |
| Manifest `sdkVersion` | 57.0.0 |

## The UI over the Wi-Fi address, in headless Chromium

The page is not a secure context here, as on a phone. This is a simulation, not an Android WebView.

| Check | Result |
|---|---|
| `crypto.randomUUID`, `navigator.clipboard` from the shims | Present |
| Normal build | Reaches an empty Library, 0 errors |
| Feasibility build, Library | 4 sample books |
| EPUB, TXT, Markdown | Content shown, 0 errors |
| PDF | Page and text layer shown, worker loaded |
| PDF time to first page | About 16 s, the same on `localhost` and on Wi-Fi. Headless and without a GPU, so not a phone figure. Recheck on a device |

An earlier run through the Radmin VPN address showed only the feasibility report line after 7 s, with no errors. The cause was not looked into: the wait was also too short for the UI to load, and the VPN address is not the one Expo uses.

## WebKit early warning (T022)

`npm run feasibility:webkit`, on loopback at phone size. **Not iOS proof.**

| Browser | Library, EPUB, PDF, TXT, Markdown |
|---|---|
| Chromium | All shown, 0 errors, 0 external requests |
| WebKit | All shown, 0 errors, 0 external requests |

## Needs a phone (T090, T021, T023)

| Item | Status |
|---|---|
| Expo Go runs SDK 57 | **Pass** on the BlueStacks 5.22 Android emulator (2026-11-03, the user's screenshot). Expo Go and Android versions not recorded. Real phone not tried |
| Expo Go's WebView loads the UI over `http` from Metro | **Pass** on BlueStacks. The address it used was not recorded, so this may not be LAN |
| Readmate UI appears in Expo Go (FR-017k) | **Pass** on BlueStacks: empty Library, as expected with the stub. The layout is still the Desktop one, which M5 adapts |
| Render, page turns, PDF.js worker, text selection, on Android | EPUB, TXT, Markdown "run fairly well" (the user, 2026-11-03; page turns and selection not itemised). PDF failed with `a.toHex is not a function`, fixed in the build (see below); **after the fix PDF runs** (the user, 2026-11-03). **Provisional pass for all 4 formats.** The user reported each format as running, without itemising page turns and text selection per format; those are checked item by item on touch in T094 and T095 |
| `sqlite_version()`, JSON functions, FTS through `expo-sqlite` (T023) | **Pass** on BlueStacks 5.22.168.1001 P64, Expo Go, `EXPO_PUBLIC_FEASIBILITY=1` (the user's screenshot, 2026-11-03): `SQLite 3.50.3 \| json_valid=1 json_extract=1 \| fts5=1`. JSON functions work, so the baseline schema keeps its JSON checks (T041). FTS5 is present but **not needed**: in-book search (`search`, `bookIndex`) is outside the first release (`contracts/mobile-bridge.md`), so no FTS table is created. This is the SQLite inside Expo Go's `expo-sqlite`; a native build may ship a different version, so T093 reruns this check. Android, Expo Go and WebView versions not recorded |

## Unverified until the Android build (FR-017m, T092, T093)

Offline start; local server; `file://`; 100 MB books; `localStorage` after a restart; final Android minimum; book size limit. Details and working values are under "Decisions" (T024).

## PDF in Expo Go: `a.toHex is not a function` (T021)

First run on the device (2026-11-03): EPUB, TXT and Markdown ran; PDF failed with `a.toHex is not a function`. pdf.js
5.4.624 calls `Uint8Array.prototype.toHex()` (ES2025, Chrome 140+) in the worker when it computes the document
fingerprint; the device's Android System WebView is older. A main-page shim cannot reach the worker.

Fix: the Mobile web build aliases `pdfjs-dist` and its worker URL to pdf.js's own `legacy/build`, which carries the
polyfills (`source/apps/reading-book-mobile/web/vite.config.ts`). Desktop keeps the modern build; the UI source is
unchanged. After the fix, `npm run feasibility:webkit` shows all 4 formats with 0 errors in Chromium and WebKit. The
device recheck passed (the user, 2026-11-03).

**Consequence for OD-10**: the WebView version, not the Android version, decides which JavaScript the UI may use.
Android System WebView updates through the Play Store, so an old WebView is possible on any Android version. Keep
the legacy pdf.js build on Mobile, and test on the oldest WebView the release accepts.

## Bundled fonts (T024)

Checked from the files themselves (`name` and `OS/2` tables), not only from the docs.

| Files in the Mobile build | Version | Licence | Reserved Font Name | Embedding (`fsType`) |
|---|---|---|---|---|
| Noto Sans Regular, Bold, Italic, Bold Italic | 2.015 | SIL OFL 1.1 | None | 0, installable |
| Noto Serif Regular, Bold, Italic, Bold Italic | 2.015 | SIL OFL 1.1 | None | 0, installable |
| Noto Sans Mono Regular, Bold | 2.014 | SIL OFL 1.1 | None | 0, installable |

All carry "Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic)". They are
Desktop's typewriter fonts (`reading-book-desktop/assets/fonts/typewriter/`), pulled in by `typewriterFonts.ts`.
They are the only fonts in the build: the CSS loads no other font file, and pdf.js is not given `standardFontDataUrl`.

The build did not carry the licence text. `scripts/build-web.mjs` now copies `OFL.txt` and `THIRD_PARTY_FONTS.md`
to `licenses/fonts/` in the shipped UI, the same files Desktop's `electron-builder.json5` packages. Before the store
release, the app's About or Licences screen should also show them (not built).

## Decisions

Recorded 2026-11-03 (T024). Provisional. The PDF recheck after the `toHex` fix passed on the device (2026-11-03); the
items under "Unverified" below can still reopen them (FR-017m).

| Decision | Value | Basis |
|---|---|---|
| **OD-4**, fallback when PDF.js or epub.js fails in a WebView | **pdf.js legacy build on Mobile** (the spec's first option). Desktop keeps the modern build. epub.js and the other formats needed no fallback | PDF failed on `Uint8Array#toHex`; the legacy build carries the polyfill. The other 3 formats ran unchanged |
| **OD-10 (provisional)**, how the WebView gets the UI and books | **Local HTTP server in the host on `127.0.0.1`** (`decisions/local-file-server.md`), as in research R2. In Expo Go only, the UI comes from Metro over the LAN and books, from M4, through `files.readChunk` up to 20 MB. `file://` is not relied on | The UI, module scripts and the PDF.js worker run over `http` in Expo Go's WebView. The server itself has not run on a device; the final close is T093 |
| **Android minimum (working)** | **Android 7.0, API 24**: React Native 0.86's `minSdk` (`react-native/gradle/libs.versions.toml`), so no `minSdkVersion` override in `app.json` yet | Nothing found that needs more. The real limit is the WebView, next row |
| **WebView minimum (working)** | **Android System WebView / Chrome 111** | Vite 8's default target (`baseline-widely-available`: `chrome111`, `safari16.4`), which no Mobile config overrides. It lowers syntax only, never runtime APIs: a newer API, like `toHex`, still needs a polyfill or a legacy build. The WebView updates from the Play Store, separately from Android |
| **Book size limit (working)** | **20 MB in Expo Go** (base64 chunks, plan.md). **100 MB target on the native build**, not measured | Books are loaded whole into WebView memory as an `ArrayBuffer`, as on Desktop. Measurement is T093 |
| **Bundled fonts** | Noto Sans, Noto Serif, Noto Sans Mono, SIL OFL 1.1, licence text shipped | "Bundled fonts" above |

### Unverified (FR-017m), to run on the Android build in T093

| Item | Why it is unverified |
|---|---|
| Offline start | Expo Go loads the UI from the computer, so it needs the network |
| Local server | Expo Go has no native module; the server has only been read (T018) |
| `file://` | Only on a native build (T017); a failure is acceptable |
| 100 MB books | Expo Go caps books at 20 MB; no memory measured |
| `localStorage` after a restart | The Expo Go origin is the computer's address, not the release origin `127.0.0.1` |
| Final Android and WebView minimum | No device below the user's has been tried |
| PDF time to first page on a phone | Only the headless figure (about 16 s) exists |

### Phone UI effort, against `ReaderScreen.tsx`

`ReaderScreen.tsx` is 2,021 lines with 89 hook calls and 11 stores; it wires the TOC sidebar, the right sidebar,
the toolbar, each format's renderer and every PDF tool directly. The desktop interactions are deep in it: right-click
menus on selections and annotations (16 files in `src/`), hover cards for replace / insert marks (85 files in `src/` have hover handlers or hover styles),
keyboard shortcuts, and resize handles for ink, graphics, typewriter boxes and attachments. Reader code has
34 responsive prefixes (`sm:` to `xl:`).

**Finding: additive changes are not enough for the Reader.** CSS below 900 px can fix the Library and Settings, but a
usable phone Reader needs its own layout: a full-screen page, a bottom bar instead of two sidebars, long-press
instead of right-click, no hover, and the PDF editing tools dropped or simplified. The user has also said the phone
interface will be redesigned (2026-11-03). That conflicts with **FR-012a** ("No separate Mobile override layer or
second set of screens"), so the spec needs the user's decision before M5. The option that keeps Desktop unchanged:
a phone Reader shell in `src/`, chosen by the Mobile signal, reusing the same stores, renderers and bridge, after
moving the wiring now inside `ReaderScreen.tsx` into stores both shells share.

**Decision (the user, 2026-11-03)**: accepted. FR-012a now gives the Reader a separate Mobile Reader UI, and the new
FR-012c allows moving wiring out of `ReaderScreen.tsx` in small steps. Scope, steps and risks are in
`contracts/phone-ui.md`; tasks T094 to T104.

## Local server and cleartext review (T018, T019)

By reading the code: Android and iOS bind `127.0.0.1`, check `Host`, allow GET only, answer `206` and `416`, refuse `..`, and report `PORT_IN_USE`. None of this has run on a device.

Release builds allow cleartext only to `127.0.0.1`. **Android debug builds allow all cleartext**, so they can reach Metro over the LAN; the plugin's override lives only in the `debug` source set.
