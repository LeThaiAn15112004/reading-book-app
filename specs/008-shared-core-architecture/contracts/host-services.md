# Contract: Host Services (WebView ↔ React Native)

The only channel between the WebView and the host. Small JSON messages over `postMessage` and injected JavaScript. **File bytes never use this channel**, except for the development-only `files.readChunk` below.

## Envelope

```ts
type Request  = { v: 1; id: string; service: string; method: string; args: unknown }
type Response = { v: 1; id: string; ok: true; result: unknown } | { v: 1; id: string; ok: false; error: { code: string; message: string } }
type HostEvent = { v: 1; event: 'lifecycle' | 'back' | 'importProgress'; payload: unknown }
```

The host accepts messages only from the bundled origin, and rejects unknown services or methods with `UNKNOWN_METHOD`. Boot values (`token`, `baseUrl`, platform) are provided before the UI starts. `injectedJavaScriptBeforeContentLoaded` is ["not 100% reliable" on Android](https://raw.githubusercontent.com/react-native-webview/react-native-webview/master/docs/Reference.md), so Android uses `injectedJavaScriptObject` or a boot request made before the UI import.

## Services

| Service.method | Input | Result | Rule |
|---|---|---|---|
| `sql.query` | `sql`, `params` | Rows | Read only; rows capped in size |
| `sql.run` | `sql`, `params` | `changes`, `lastInsertRowId` | One statement |
| `sql.transaction` | `statements[]` | Per-statement result | All or nothing, in `withExclusiveTransactionAsync` |
| `files.pick` | `extensions[]` (subset of `epub`, `pdf`, `txt`, `md`) | `{ status: 'picked', pickId, name, size, extension }`, `{ status: 'cancelled' }` or `{ status: 'unsupported', name }` | Picker only; no path returned. iOS reads a cache copy; Android reads the picker's `content://` document once, in `files.stage` (in Expo Go the cache copy is outside the scoped folders and cannot be opened, 2026-11-05); a `content://` URI is never deleted |
| `files.stage` | `pickId`, `stagingId` (UUID) | Staged size | Copies in 1 MiB chunks with `importProgress`; `NO_SPACE` (checked before copying, and on a write failure), `CANCELLED`, `READ_FAILED` |
| `files.hashStaged` | `stagingId` | SHA-256 hex and size | Chunked, incremental (`src/host/sha256.ts`, same digest as Desktop) |
| `files.cancel` | `stagingId` | Whether a job was running | Stops `stage` / `hashStaged` between chunks; the job then fails with `CANCELLED` and removes its staging folder (added at M4) |
| `files.commitStaged` | `stagingId`, `bookId` | Relative path | Moves staging to `books/{bookId}/file`; `ALREADY_EXISTS` when that folder exists |
| `files.discardStaged` | `stagingId` | Done | Idempotent |
| `files.removeBook` | `bookId` | Done | Validates `bookId` as a UUID; removes exactly `books/{id}/` and `covers/{id}.png` |
| `files.writeCover` | `bookId`, PNG as base64 | Relative path | At most 4 MB, PNG signature checked; covers only |
| `files.sweep` | Known book ids | Removed count | Clears staging (except running jobs) and orphan book folders and covers |
| `app.info` | None | Version, platform, OS version | |
| `app.setSystemBars` | `top`, `bottom` as `#rrggbb` | Done | The bars are transparent (edge-to-edge): the host paints the areas behind the status bar and the navigation bar with these colours, and picks light or dark status bar icons by luminance. The bridge reads them from the page's top and bottom edge (`web/src/bridge/system-bars.ts`) on theme change, navigation, resize and once a second; only changes are sent (added 2026-11-05) |
| `app.boot` | None | Boot values | Fallback when the injected boot object did not arrive (added at M4) |
| `app.openExternal` | `url` | Done | `https` only, public host name (no IP, `localhost`, `.local` or credentials) |

Implementation (M4): `src/host/rpc.ts` (dispatcher), `sql-service.ts`, `file-service.ts`, `app-service.ts`, plain TypeScript over ports, run by the vitest suite (`web/tests/host-services.test.ts`, and the bridge suites through `web/tests/fake-host.ts`); the device adapters are `expo-sqlite-engine.ts` and `expo-host-fs.ts`, wired in `host-runtime.ts`.

No service writes to an imported book file, and none accepts an arbitrary path.

## Local server (`baseUrl`, loopback only)

| Route | Auth | Response |
|---|---|---|
| `GET /` and UI assets | None | Bundled UI |
| `GET /books/{bookId}?t={token}` | Token | File with `Range` support (`206`, `416`), `application/octet-stream`, `Cache-Control: no-store` |
| `GET /covers/{bookId}?t={token}` | Token | `image/png`, `Cache-Control: no-store` |

The token is per launch, made by the native module (`SecureRandom` / `SecRandomCopyBytes`) and returned by `start()`, and kept across a restart after the app returns to the foreground. It travels as a query parameter so an `<img>` can use the cover URL. The id must match a UUID on the raw path (no decoding); a missing or wrong token answers `403`.

Requirements: GET only, no directory listing, ids validated, no path traversal, `Cache-Control: no-store` on book routes. Binary uploads such as covers use a method chosen at M2, since a read-only static server cannot accept them. Base64 over `postMessage` is acceptable for covers because they are small and capped.

## Expo Go development mode

Applies only when `__DEV__` is true and the app runs in Expo Go. A release build has none of this.

| Item | Rule |
|---|---|
| UI origin | `http://{hostUri}`; the page is `/readmate-ui/index.html`, served by Metro. It is accepted as the origin by the RPC check, `originWhitelist` and navigation checks |
| Local server | Not loaded. `baseUrl`, `token` and the routes above do not exist |
| `files.readChunk` | Input `bookId`, `offset`, `length`. Result base64, `eof` and `size`. `length` at most 1 MiB, `bookId` validated as a UUID, app-private books only, read only. `BOOK_TOO_LARGE_FOR_DEV` above 20 MB. Every other build answers `UNKNOWN_METHOD` (the method is not registered) |
| Covers | `coverUrl` uses a `data:` URL from the development-only `files.readCover` (`bookId` → base64 or null), since there are no cover routes |

## Lifecycle

| Event | Behaviour |
|---|---|
| Background | Host sends `lifecycle`, and the bridge triggers `onRequestFlushSession` |
| Foreground | Host checks the server and restarts it if needed |
| WebView process gone (`onRenderProcessGone`, `onContentProcessDidTerminate`) | Host reloads the WebView; UI re-reads from SQLite |
| Android back | Host sends `back`; bridge calls `history.back()`; at the root, the app exits normally |

## WebView settings

`originWhitelist` limited to the local origin; navigation elsewhere blocked and sent through `app.openExternal` after a check; file-access flags stay off if the HTTP route is selected; EPUB scripts stay off, as on Desktop; a strict CSP in `web/index.html`.
