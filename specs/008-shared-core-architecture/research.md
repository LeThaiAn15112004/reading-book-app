# Research: Readmate Mobile WebView

Checked 2026-10-31. **Nothing here has run on a device.** Items marked *Gate* are working decisions that M2 must confirm.

## R1. How the UI is built and loaded

- **Decision**: A Vite config in `reading-book-mobile/web`, with no Electron plugin. Its entry installs `window.api`, then imports Desktop's `src/main.tsx`. Output is copied into the app and loaded offline.
- **Rationale**: Desktop's UI relies on Vite features (`?url`, `import.meta.glob`), so Vite reuses it unchanged. `HashRouter` needs no server routes.
- **Build details found in code**:
  - Desktop's `index.html` loads Google Fonts, so the Mobile page must not; fonts are bundled, with licences confirmed at M2.
  - Tailwind's automatic source scan follows the Vite root, so the Mobile entry must add `@source` for Desktop's `src/`.
  - `react` and `react-dom` must be aliased to the root 18.3.1 copy, or code near Mobile could resolve to 19.
  - The `/spike/epub` route stays in `App.tsx`; it is unlinked and harmless, and its bundle size is checked at M2.
- **Alternatives**: Remote hosting breaks offline use. Metro's web build cannot process Desktop's Vite-specific code.

## R2. How the WebView gets the UI and book bytes (OD-10) *Gate*

- **Decision**: Start from a loopback HTTP server in the host on `127.0.0.1` with a **fixed port**, serving the UI, book copies and covers. Book and cover routes need a per-launch token.
- **Rationale**:
  - `postMessage` data must be a string ([WebView reference](https://raw.githubusercontent.com/react-native-webview/react-native-webview/master/docs/Reference.md)), so a binary book would have to be encoded, wasting memory.
  - An http origin gives module scripts and workers normal behaviour, which PDF.js needs.
  - A stable origin matters: `localStorage` is per origin, so a changing port would lose preferences.
- **Alternatives**:
  - `file://` with `allowingReadAccessToURL` and `allowFileAccess`: tried first in M2 because it adds no native code, but workers and modules from `file://` are a known risk without a primary source here. File-access flags also widen security exposure.
  - Custom scheme: the WebView reference documents no custom scheme handler, so it would need native changes.
- **Server candidates, decided at M2 with a record**: `@dr.pogodin/react-native-static-server` ([one Expo user reported an Android build failure](https://forums.expo.dev/t/serving-local-html-in-webview/74761)), [react-native-web-server](https://github.com/WheelerLee/react-native-web-server), or a small in-repo Expo module. Token and Range support are required criteria; [some servers need files in a writable folder](https://spin.atomicobject.com/static-http-server-react-native/). None was evaluated beyond these sources.
- **To verify**: Android cleartext rule for `127.0.0.1`, iOS transport rules, server restart after backgrounding, port already in use.

## R3. Where bridge logic and stores run

- **Decision**: In the WebView, in TypeScript. The host stays thin.
- **Rationale**: The SDK already runs in that engine and has never run on Hermes (audit §3). It also allows tests on Node without a device, and leaves one JavaScript runtime for all reading logic.
- **Trade-off**: Each SQL call crosses the bridge. Mitigated by batching and by keeping saves atomic. The OS may kill the WebView, but the host process keeps the database safe.
- **Alternative**: Stores in the host survive WebView death, but need the SDK on Hermes and a device for most tests.

## R4. SQLite on Mobile

- **Decision**: `expo-sqlite`, with statement batches run in `withExclusiveTransactionAsync`.
- **Facts** ([Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)): `enableFTS` defaults to true (FTS3/4/5). Inside `withExclusiveTransactionAsync` only `txn` queries join the transaction, and other async writes can hit `database is locked`; `withTransactionAsync` would include unrelated queries, so it is rejected. The docs give no SQLite version and do not mention JSON functions.
- **Gate**: M2 runs `sqlite_version()` and a JSON function check. If JSON functions are missing, JSON `CHECK`s and indexes are dropped from the Mobile baseline and validated in stores.
- **Consequence**: One writer queue in the bridge prevents the lock error.

## R5. Workspace layout

- **Facts**: `source/package-lock.json` already includes Mobile, and places `react-native` under `apps/reading-book-mobile/node_modules`, because of the React conflict. CI uses only this lockfile. Desktop and Mobile also track their own older lockfiles (July, against October for the root). Repo-root `package.json` has its own lockfile for `concurrently`, outside `source/`.
- **Decision**: Keep the root lockfile, remove the two app lockfiles at M1, and keep Desktop on React 18.
- **Consequence**: **Truly one `node_modules` is not possible.** React 19 and the packages depending on it stay nested under Mobile. [workspace-exceptions.md](./workspace-exceptions.md) lists them; the nesting is much larger than React alone. Upgrading Desktop to React 19 is rejected because it changes Desktop.
- **Metro**: [Expo configures monorepos automatically since SDK 52](https://docs.expo.dev/guides/monorepos/) and says not to set `watchFolders` by hand, so the manual setting is removed; verify there is one React copy. Metro bundling itself is still unverified (audit §9).

## R6. Reader compatibility

| Area | Evidence in code | Assessment | M2 test |
|---|---|---|---|
| PDF.js | `Promise.withResolvers`, `Promise.try`, `fromBase64`, `OffscreenCanvas`, module worker URL; `legacy/build` ships | iOS 18.2+ has `Promise.try` and `fromBase64` ([web-features](https://web-platform-dx.github.io/web-features-explorer/features/promise-try), [caniuse](https://caniuse.com/mdn-javascript_builtins_uint8array_frombase64)). Android WebView updates separately; older ones may need legacy | Render, selection, large file |
| epub.js | Iframes, scripts off, pagination, CFI | Standard web APIs; touch page turns untested | Open, turn, restore, highlight |
| Text selection | `getSelection` in 12 files, `caretRangeFromPoint` family in 4 | **Highest risk**: OS selection handles and callouts differ from mouse selection, and iOS is stricter | Select and highlight in EPUB, PDF, TXT, Markdown |
| Pointer tools | `setPointerCapture` in 9 files, touch in 1 | Pointer events cover touch, but gestures conflict with scrolling | Pan, page turn |
| Right-click | 16 files | No equivalent on touch | Long-press replacement, M5 |
| Hover, keyboard | 82 and 52 files | Hover-only controls may be unreachable | M5 audit |
| TTS | `speechSynthesis` | Excluded by gating to keep scope | None |
| `localStorage` | 21 files | OS may clear web data on some paths | Restart and low-storage checks |

## R7. Import and hashing

- **Decision**: Picker with copy to cache → copy into `books/{uuid}/file` → hash → duplicate check → metadata → row. Metadata and covers are done in the WebView, with existing code where possible (`generateBookCover.ts`, SDK `epub/` parser).
- **Gate**: Desktop's SHA-256 must be matched without holding a big file in memory. Preferred: chunked reads from `expo-file-system` with an incremental hash. API details are checked against Expo 57 docs at M2, as Mobile's `AGENTS.md` requires.
- **Alternative**: A native hash in the local module if chunked reads are too slow.

## R8. Hiding unsupported features

- **Decision**: Reuse `src/reader/capabilities.ts`, which hides toolbar tools by surface capability. Other menus (cloud, audio import, Settings groups) check one additive helper in `src/platform/`. In Electron the helper allows everything, so behaviour is unchanged.
- **Alternative**: Bridge errors alone would show controls that always fail, breaking the spec's scenario 3.3.

## R9. Build environment

- **Decision (updated 2026-11-02, see R10 to R14)**: Expo Go for development; an Android build on the Windows machine for the real app, deferred (FR-017l). Expo Go [cannot carry custom native code](https://forums.expo.dev/t/how-to-run-local-html-js-spa-with-expo-and-webview/56973). Code follows the compatibility rules in [plan.md](./plan.md); iOS testing is a separate task (OD-11).
- **Facts** ([Expo build properties](https://docs.expo.dev/versions/latest/sdk/build-properties/)): the iOS `deploymentTarget` plugin option is deprecated in favour of the built-in `ios.deploymentTarget` from SDK 56. `usesCleartextTraffic` defaults to `false` on Android 9+, so loopback HTTP needs explicit configuration.
- **Repo check**: no npm script uses PowerShell or `cmd`-only syntax; `/ios` and `/android` are git-ignored; `app.json` has no `bundleIdentifier` or deployment target yet.
- **Note**: a Docker environment can share Node and Expo tooling; whether it covers Xcode is checked in that task.
- **Alternative**: Writing Android first and porting later is rejected, because it invites Android-only choices.

## R10. Why `npx expo start` fails, and the fix

Tested on this Windows machine on 2026-11-02. Nothing has been opened on a phone yet.

- **Cause**: `@expo/metro-config` is hoisted to `source/node_modules`, but `expo` is nested under Mobile because of the React conflict. At load, the hoisted copy calls `require.resolve('expo/package.json')` and fails, so Metro never starts.
- **Decision**: A Mobile `postinstall` links `source/node_modules/expo` to Mobile's `expo` (junction on Windows, symlink elsewhere). It does nothing if Mobile's `expo` is missing.
- **Evidence**: With a temporary link and plain `npx expo start`, Metro started and the Android host bundled: HTTP 200, 1,441 modules, React 19.2.3 and no React 18. The `lightningcss` failure in `baseline.md` did not occur. The link was removed afterwards, so the repo is still broken until the task is done. iOS bundling was not run.
- **Alternatives**: `NODE_PATH` also starts Metro, but plain `npx expo start` cannot set it, and `metro.config.js` loads too late. A root `expo` dependency would resolve React 18. Forcing npm to nest `@expo/metro-config` has no supported setting.
- **To verify**: The link survives `npm ci` and `npm install`, Desktop checks still match the baseline, and `electron-builder` does not package it.

## R11. How Expo Go gets the UI

- **Decision**: Serve the built `web/dist` from Metro at `/readmate-ui/`, through `config.server.enhanceMiddleware` in `metro.config.js`. The route is GET only and refuses path traversal. If `web/dist` is missing, it answers with a page saying to run `npm run build:web`.
- **Rationale**: `npx expo start` stays the only command. The phone already reaches Metro, so no second port or firewall rule is needed. The page is the same build the real app ships, with the same CSP. `base: './'` and `HashRouter` work under a sub-path.
- **Evidence**: `instantiateMetro.js` in `@expo/cli` keeps a custom `enhanceMiddleware`. This was read in the code, **not yet run**.
- **Trade-off**: There is no hot reload of the UI. The user rebuilds or runs `vite build --watch`, then reloads.
- **Alternative**: A Vite dev server gives hot reload, but it needs a second process and port, a relaxed CSP (React Refresh uses an inline script, and `script-src` is `'self'`), and many separate requests over Wi-Fi.

## R12. The host in Expo Go

- **Decision**: `src/host/ui-source.ts` checks `__DEV__` and `Constants.executionEnvironment === 'storeClient'`. If both hold, the URL comes from `Constants.expoConfig.hostUri`. Otherwise it `require`s the local server inside the branch, since `requireNativeModule` throws at import where the module is absent, as it is in Expo Go. A missing `hostUri` shows a clear message.
- **Also**: `originWhitelist`, navigation checks and the RPC origin check accept the Metro origin in this mode.
- **Assumed, to check on a phone**: Expo Go lets the WebView load LAN `http`, and a current Expo Go runs SDK 57. `react-native-webview`, `expo-sqlite`, `expo-file-system` and `expo-document-picker` are expected in Expo Go, as the Expo docs describe.

## R13. A LAN page is not a secure context

- **Finding**: `http://192.168.x.x` is not a secure context, unlike `127.0.0.1`. There `crypto.randomUUID`, `crypto.subtle` and `navigator.clipboard` are normally undefined. The UI calls `crypto.randomUUID()` directly in the highlight, PDF, Markdown, TXT and bookmark stores, so creating an annotation would throw. `ReaderScreen.tsx:908` calls `navigator.clipboard.writeText`.
- **Decision**: `web/src/main.ts` adds `crypto.randomUUID` (through `getRandomValues`) and a harmless `navigator.clipboard`, only when absent. Desktop's source does not change. `crypto.subtle` needs no substitute: the UI does not use it, the SDK reaches it only through `createBookReaderSdk`, which is not used, and PDF.js has no `subtle` reference. The Mobile hash stays incremental JavaScript (R7).
- **Limit**: Other secure-context differences may only show on the real build, which is one reason FR-017m keeps that check.
- **Alternative**: `adb reverse` gives a secure `127.0.0.1` page, but needs USB and Android only.

## R14. Book bytes in Expo Go

- **Decision**: Add a development-only `files.readChunk` that returns base64, used only when the local server is absent. The working limit is 20 MB per book, and a larger book shows a clear message. M2 samples need no such route, since they come from `web/dist`. The route is built with the bridge at M4.
- **Rationale**: A server on the computer cannot read files stored on the phone, and Expo Go has no other route.
- **Trade-off**: This breaks "file bytes never use this channel" in development only. A release build rejects the method with `UNKNOWN_METHOD`. Memory results from this route say nothing about the real one.
