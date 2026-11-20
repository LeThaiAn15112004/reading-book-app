# Contract: phone host services (016)

Changes to `platforms/native/host/file-service.ts` + `expo-host-fs.ts` (`contracts/host-services.md` of spec 008 is
updated in the same change). Messages stay small JSON; no service accepts a path from the WebView.

| Method | Change |
|---|---|
| `files.pick` | `{ extensions, multiple?: boolean }`; `multiple` → `DocumentPicker.getDocumentAsync({ multiple: true })`; answers `{ status: 'picked', items: [{ pickId, name, size, extension \| null }], notAdded }` (first 50 in picker order) or `{ status: 'cancelled' }`; the single-file answer shape is kept when `multiple` is absent |
| `files.stage` | `HostFs.copyUri(uri, rel)` = `await new File(uri).copy(appFile(rel))` (native). While it runs the host polls `fileSize(rel)` every 250 ms → `copying` progress. Refusal (`InvalidPermission…`) → today's chunked loop for this file only. Cancel → honoured when `copy()` resolves; staging removed; `CANCELLED`. `NO_SPACE` check before copying unchanged |
| `files.hashStaged` | `HostFs.digest(rel)` = `await appFile(rel).digest('SHA-256')` (native, lowercase hex); `{ sha256, size }` unchanged; progress: one `checking` event with `total: null` |
| `files.readRange` (new, every build) | `{ bookId, offset, length ≤ 1 MiB }` → base64 bytes of `books/{bookId}/file`; used only when the local server is absent (Expo Go). Release builds read ranges from the local server (`Range` → `206`) |
| `files.checkPick` (new) | `{ pickId }` → `{ readable }` (`new File(uri).exists` and an open-read of 1 byte); used after a relaunch |
| `importQueue.load` / `importQueue.save` (new group) | JSON snapshot in `Paths.document/import-queue.json` (temp + move); `pickId → uri` kept host-side in `import-picks.json`; ≤ 200 jobs, ≤ 256 KiB, else `INVALID_ARGUMENT` |

Startup order (host): staging sweep (existing) → `import-picks.json` entries without a job in `import-queue.json`
dropped → WebView loads → `importQueueStore` calls `importQueue.load`.

Not added (FR-013b): no foreground service, no notification, no background task API.
