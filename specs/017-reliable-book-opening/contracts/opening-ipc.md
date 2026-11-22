# Contract: IPC / host changes

Four-place rule (CLAUDE.md): every new or changed channel is updated in `channels.ts`, its `*.ipc.ts`, `preload.ts` +
`api-types.ts`, and `bridge/*.ts`; the phone implements the same `Window['api']` member. Every changed Main file gets
an approval line in `source/scripts/desktop-main-changes.json`.

## `library:openBookContent` (changed result, same channel)

```ts
type OpenBookContentResult =
  | { ok: true; bookId; format; data: ArrayBuffer; byteLength }
  | { ok: false; bookId; errorCode: OpenBookErrorCode; errorMessage: string; retryable?: boolean }
// OpenBookErrorCode gains: 'not_available_offline' | 'file_changed'
// ('protected' is NOT an IPC code: it is detected in the renderer — pdf.js PasswordException, EPUB encryption.xml)
```

- Hashes the bytes (`servedSha256`) **only for PDF** (R6).
- Sends the `readFile` buffer's own `ArrayBuffer` when it is not a pooled slice; at most one copy in Main.
- `retryable: true` for `EBUSY | EAGAIN | EIO | EMFILE` read errors (R3).
- Phone bridge: same shape; `retryable: true` when the local-server fetch threw or answered 5xx.

## `import:releasePicks` (new, Desktop; phone: `files.releasePicks` host call)

```ts
releasePicks(input: { pickIds: string[] }): Promise<{ ok: true; released: number }>
```

- Called by `importQueueStore` when a waiting `pick` job is cancelled, dismissed, or removed by Clear finished.
- Unknown ids are ignored. `takePickedFile` still removes a pick when its job starts.
- `picked-files.ts`: no time-based expiry; at most 500 held (the oldest beyond that is released, its job fails with
  `missing_file` → shown as "pick the file again").

## Import "file changed" (behaviour, `import.ipc.ts`)

- size differs → `file_changed`; mtime differs, size equal → re-hash with the job's signal; same SHA-256 → continue.
- A cloud placeholder that cannot be read → `not_available_offline` (new `ImportErrorCode`), message
  `main.messages.import.notOffline`.

## Phone host: `app.setReaderOpening` (new host method)

```ts
// WebView → host
{ service: 'app', method: 'setReaderOpening', args: { opening: boolean } } → { ok: true }
```

- Sent by `bridge/app.ts` `setReaderOpening` (today a no-op).
- Foreground on the phone (implemented 017 US1): NO new host event. The host already sends `lifecycle { state:
  'active' | 'background' }` on every AppState change; `bridge/app.ts` re-dispatches it as the DOM event
  `readmate:foreground { detail: { active } }`, which `readerOpeningStore.installOpeningStoreDomSources()` feeds to its
  foreground clock (opening time limits count foreground time only). `tests/fake-host.ts` emits it with
  `host.emit('lifecycle', …)`.
- `file-service.ts` chunk loops (`stage` fallback, `hashStaged` fallback) await `whenNotOpening()` between chunks,
  bounded at 10 s like the 016 gate.

## Messages (phone bridge)

`native/bridge/import.ts` and `library.ts` return `errorMessage` from `getT()` with the `main.messages.import.*` /
`main.messages.common.*` keys Main already uses (FR-023), never English literals.
