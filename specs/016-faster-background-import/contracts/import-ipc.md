# Contract: import / library / app channels (016)

Both hosts implement every method below with the same types: Desktop through the four IPC places (`channels.ts`,
`<feature>.ipc.ts`, `preload.ts` + `api-types.ts`, `bridge/<feature>.ts`), the phone through `platforms/native/bridge/*`
(typed by `Window['api']`, so a missing method fails `mobile:typecheck:web`). DTOs are plain objects; no path ever
reaches the renderer. Every new Main file / changed Main file gets a line in `source/scripts/desktop-main-changes.json`.

## Changed

| Channel | Change |
|---|---|
| `import:fromFile` | kept for compatibility (one file, now returns the same `ImportResult` through the queue runner); the UI uses `pickFiles` + `runJob` |
| `import:fromUrl` | gains an optional `jobId`; progress events carry it; cancel by `cancelJob` |
| `import:progress` (event) | payload gains `jobId` and `step: 'downloading' \| 'copying' \| 'checking' \| 'reading' \| 'saving'`, `doneBytes`, `totalBytes \| null` (old `stage` kept for one release) |
| `cloud:downloadAndImport` | gains an optional `jobId` (progress + cancel like URL) |
| `library:setGeneratedCover` | returns `{ ok: true, coverUrl } \| { ok: false }` (was `OkResult`) |
| `zipImport:confirm` | unchanged on the wire; the renderer calls it from the queue runner for a `zip` job |

## New

```ts
// ImportChannels
pickFiles(): Promise<{ status: 'cancelled' } | {
  status: 'picked'
  items: { pickId: string; name: string; sizeBytes: number; kind: 'book' | 'zip' | 'unsupported'; format?: DocumentFormatDto }[] // ≤ 50
  notAdded: number   // files beyond 50 (FR-011a)
}>
runJob(input: { jobId: string; pickId: string }): Promise<ImportResult>
cancelJob(input: { jobId: string }): Promise<{ ok: boolean; reason?: 'saving' | 'unknown' }> // refused while saving
reportActivity(input: { running: number; waiting: number }): Promise<OkResult>   // Desktop quit guard; phone no-op
onCancelAll(cb: () => void): () => void   // Main → renderer before a confirmed quit

// LibraryChannels
getCoverSource(bookId: string): Promise<
  | { ok: true; kind: 'text'; text: string }        // ≤ 4 000 chars
  | { ok: true; kind: 'pdf'; sizeBytes: number }
  | { ok: false; errorCode: 'not_found' | 'missing_file' | 'path_denied' | 'read_failed' | 'nothing_to_render' }>
readBookRange(input: { bookId: string; offset: number; length: number }): Promise<
  | { ok: true; data: ArrayBuffer } | { ok: false; errorCode: 'not_found' | 'missing_file' | 'path_denied' | 'range' | 'read_failed' }>

// AppChannels
setReaderOpening(input: { bookId: string | null }): Promise<OkResult>
getTimingEnabled(): Promise<boolean>
recordTiming(line: StepTimingDto): Promise<OkResult>   // ignored unless timing is on
```

`ImportResult.errorCode` gains `file_changed` ("The file changed or is no longer there", spec edge case) and
`interrupted` (phone relaunch). `readBookRange`: `offset ≥ 0`, `1 ≤ length ≤ 1 048 576`, `offset + length ≤ size`
(else `range`); only for a library book's validated file (`resolveBookFile`); audio formats refused.

## Main-side behaviour (Desktop)

- `runJob` steps: `checking` (one `hashFile` with progress + `AbortSignal`, then `findBySha256`) → `reading`
  (importer with `known` hash; EPUB through the ranged ZIP reader) → `saving` (stat unchanged check, then
  `persistImportedBook`, not cancellable) → `scheduleSignatureCheck(bookId)` (PDF; after the result is returned).
- One `runJob` at a time; a second concurrent call answers `save_failed` ("Another import is still running") — the
  renderer queue never does that.
- Cancel before `saving`: the stream is aborted, the extracted cover removed; a referenced file is never touched.
- Quit guard: see research R11; `onCancelAll` → the renderer cancels waiting jobs and the running one; Main waits
  ≤ 3 s, then quits; the startup sweep covers what was left.

## Phone bridge

Same methods. `pickFiles` → host `files.pick { multiple: true }`; `runJob` → `files.stage` (native copy) →
`files.hashStaged` (native digest) → write queue: `findBySha256` → `commitStaged` → EPUB details + cover through
the ranged reader on the committed file → `persistImported`. `reportActivity` / `onCancelAll` are no-ops (no quit
dialog on the phone). New group `importQueue`: `load(): Promise<QueueSnapshotDto | null>`, `save(snapshot):
Promise<OkResult>`, `checkPick(pickId): Promise<{ readable: boolean }>` (see [phone-host.md](./phone-host.md)).
