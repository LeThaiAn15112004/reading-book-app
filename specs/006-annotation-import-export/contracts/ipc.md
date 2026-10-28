# IPC contract

Four places stay in sync: `electron/ipc/channels.ts`, `electron/ipc/annotation-transfer.ipc.ts`, `electron/preload.ts` + `DesktopApi` (`api-types.ts`), `src/bridge/annotationTransfer.ts`.

New `AnnotationTransferChannels` group:

| Channel | Renderer sends | Returns |
|---|---|---|
| `annotationTransfer:count` | `bookId` | `{count}` (enables or disables the menu item) |
| `annotationTransfer:exportRestore` (menu label "Export annotations (backup)…") | `bookId` | `ExportResult` (save dialog in Main) |
| `annotationTransfer:exportReadable` (menu label "Export readable copy…") | `bookId` | `ExportResult` |
| `annotationTransfer:pickFile` | `{ bookId? }` | `ImportPreviewDto` or `{ok:false, errorCode}` (open dialog in Main with two filters, "Annotation files (*.readmate-notes.json)" first and "All files"; Main validates the CONTENT as well as the name, so a chosen `.md` answers `not_annotation_file` with a "readable copies cannot be imported" hint; with `bookId`, Main identifies the file's book and sets `requiresChoice` when it differs; it resolves the target's book file first -> `file_unavailable` with a relink hint) |
| `annotationTransfer:setTarget` | `sessionId, bookId` | `ImportPreviewDto` (the user's explicit choice of target, either the proposed book or the one the import started from; clears `requiresChoice`) |
| `annotationTransfer:confirm` | `sessionId` | `ImportResult` (job; progress events; re-validates inside the transaction, `target_not_confirmed` while `requiresChoice` is set and no `setTarget` was made; `stale_preview` if the book or its annotations changed since the preview). The renderer reloads the open book's annotations only after an `ok` result |
| `annotationTransfer:discard`, `annotationTransfer:cancel` | `sessionId` | `OkResult` |
| `annotationTransfer:progress` (Main -> renderer) | — | `{sessionId, phase, done, total}` |

Rules: the renderer never passes or receives a filesystem path, only `bookId` / `sessionId`. Main re-validates ids, format and file version. Audiobook ids answer `not_found`.

Cancel only takes effect before the commit phase (the commit is one synchronous transaction). `progress.phase`: `reading` | `planning` | `committing`.
