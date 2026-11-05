# Contract: Mobile Bridge (`window.api` in the WebView)

**Shape**: the existing `DesktopApi` in `electron/ipc/api-types.ts`, used as the type Desktop's UI already sees (`Window['api']`, from `electron/electron-env.d.ts`), so no file under `electron/` is imported. `src/bridge/*` does not change. `window.api` must exist before Desktop's `src/main.tsx` loads.

Method lists come from `src/bridge/*` and `electron/preload.ts`, and are checked against the full interface at M4. TypeScript must fail if the Mobile object does not satisfy `DesktopApi`.

## Implemented in the first release

| Group | Methods | Notes |
|---|---|---|
| `app` | `ping`, `getAppInfo`, `setChromeTheme`, `onRequestFlushSession`, `openExternalLink` | The flush event fires when the app goes to the background |
| `library` | `listBooks`, `getBook`, `openBookContent`, `markAsReading`, `markAsCompleted`, `setFavorite`, `setGeneratedCover`, `updateMetadata`, `removeBook`, `listCollections`, `createCollection`, `updateCollection`, `deleteCollection`, `addBookToCollection`, `removeBookFromCollection` | `openBookContent` fetches from the local server, then returns the same `ArrayBuffer` result |
| `overlay` | `getSessionState`, `saveSessionState`, `listBookmarks`, `saveBookmark`, `deleteBookmark`, `listHighlights`, `saveHighlight`, `deleteHighlight` | Same DTOs and JSON |
| `import` | `fromFile`, `cancel`, `onProgress` | Copy-based (FR-017g); same `ImportResult` |
| `txt` | `open` | Always returns read-only |

## Safe empty results

Called by screens while reading, so they must not raise errors or show failure:

| Method | Result |
|---|---|
| `overlay.listInk`, `listPdfAnnotationConflicts` | Empty list |
| `overlay.watchPdfEmbeddedAnnotations`, `unwatchPdfEmbeddedAnnotations` | Success, no events |
| `app.getFullscreen`, `onFullscreenChanged` | `false`; never fires |
| Other `on*` subscriptions | Return an unsubscribe function; never fire |

The full list is confirmed at M4 by running the journey and logging every call.

## Not available

Every other method resolves with the method's existing failure shape where it has one, using a `not_available` code. Otherwise it rejects with:

```ts
class NotAvailableOnPlatformError extends Error { code = 'NOT_AVAILABLE_ON_PLATFORM'; method: string }
```

Includes: `cloud`, `translation`, `transcription`, `zipImport`, `audio`, `attachments`, `graphics`, `annotationTransfer`, `notifications`, `background`, `updates`, `storage`, `bookIndex`, `search`, `wordCount`, `txt.commit`, `import.fromUrl`, `library.showInFolder`, `copyFilePath`, `relinkBook`, `checkSignature`, `removeAudiobook`, `deleteBookFile`, `overlay.saveInk`, `exportAnnotatedPdf`.

The UI must not reach these in normal use ([phone-ui.md](./phone-ui.md)). Reaching one in the journey is a bug.

**Note**: in-book search depends on `search` and `bookIndex`, so it is not in the first release. The spec's scope does not list it.

## Mobile differences inside implemented methods (M4)

| Method | On Mobile |
|---|---|
| `getAppInfo` | `platform` is `android` or `ios`; `transcriptionSupported` is false |
| `getGoogleOAuthConfig`, `setChromeTheme` | `null`, `{ ok: true }`: no cloud, no native title bar |
| `openExternalLink` | `https` links to a public host only (Desktop also allows `mailto` and `http`) |
| `library.listBooks`, `getBook` | `fileStorage` is `referenced`, so Desktop's "Delete file" is not offered: Remove already deletes the app copy. `fileName` is `{title}.{format}`, since the stored path is `books/{id}/file` |
| `library.openBookContent` | Too large in Expo Go (above 20 MB) answers `too_large` with a message that names Expo Go |
| `library.removeBook` | Removes the rows, then the app copy and cover (FR-017h); a file that cannot be removed is left for the startup sweep |
| `overlay.saveHighlight` | Creates `highlight`, `underline`, `strikethrough`, `squiggly` only; TXT rows refused (`null`), as on Desktop |
| `import.fromFile` | No space answers `save_failed` with "There is not enough free space on this device for this book. Nothing was added." (Desktop has no no-space code) |
| `txt.open` | `revision` 0, `editable` false, `edited` false |

At start-up the bridge migrates the database, then calls `files.sweep` with the ids of every book, before `window.api` exists.

## Call log (T064)

Every bridge call is counted by `group.method` in `window.__readmateBridgeLog.calls`, and every not-available method reached in `window.__readmateBridgeLog.notAvailable` (also a console warning). Read it from the WebView debugger after a journey run; the run itself needs the phone.

## Rules

- DTOs stay structured-clone-safe plain objects.
- No real filesystem path or `content://` reference reaches the UI.
- Saves are atomic: a call either fully commits or fails with no change.
- Writes are serialized through one queue.
- Failures use Desktop's existing error shapes, so UI messages keep working.
