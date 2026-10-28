# IPC Contract: `transcription:*`

Registered in `electron/ipc/channels.ts` as `TranscriptionChannels`, handled in `electron/ipc/transcription.ipc.ts`, exposed via `preload.ts` / `DesktopApi`, wrapped in `src/bridge/transcription.ts`. Renderer passes only `bookId` / `trackId` — never paths.

## Invoke channels

| Channel | Request | Response |
|---|---|---|
| `transcription:getInfo` | `{ bookId }` | `{ transcript: TranscriptSummaryDto \| null, job: JobDto \| null, models: ModelInfoDto[], decoder: { available: boolean, reason?: string } }` |
| `transcription:start` | `{ bookId, scope: ScopeDto, language: string, modelId: string, replace?: boolean }` | `{ jobId }` or error |
| `transcription:cancel` | `{ jobId }` | `{ ok: true }` |
| `transcription:downloadModel` | `{ modelId }` (only after user confirmation in UI) | `{ ok: true }` (progress via event) |
| `transcription:getPassages` | `{ bookId, trackId?, fromMs?, toMs?, limit? }` | `{ passages: PassageDto[] }` |
| `transcription:search` | `{ bookId, query, limit? }` | `{ hits: { passageId, trackId?, startMs, snippet }[] }` |
| `transcription:export` | `{ bookId }` | `{ saved: boolean }` (Main-owned save dialog; writes plain text) |
| `transcription:delete` | `{ bookId }` | `{ ok: true }` |

## Events (Main → Renderer)

- `transcription:progress` — `JobDto` snapshot (throttled ≤ 4/s). `doneMs`/`totalMs` are whole-job progress over the requested scope; `trackId`/`trackDoneMs`/`trackTotalMs` describe the track currently processed and are present only for multi-track books.
- `transcription:passagesAdded` — `{ bookId, trackId?, fromMs, toMs }` so the open panel refetches the new span
- `transcription:modelProgress` — `{ modelId, loadedBytes, totalBytes }`

## DTOs

```ts
type ScopeDto =
  | { kind: 'whole' }
  | { kind: 'track'; trackId: string }
  | { kind: 'range'; trackId?: string; startMs: number; endMs: number }

interface PassageDto { id: number; trackId?: string; startMs: number; endMs: number; text: string }
interface TranscriptSummaryDto { status: 'partial'|'complete'|'failed'|'cancelled'; lastError?: TranscriptionErrorCode; language: string; modelId: string; coveredMs: number; totalMs: number; passageCount: number }
interface JobDto { jobId: string; bookId: string; state: 'queued'|'preparing'|'running'|'done'|'failed'|'cancelled'; doneMs: number; totalMs: number; trackId?: string; trackDoneMs?: number; trackTotalMs?: number; error?: TranscriptionErrorCode }
interface ModelInfoDto { id: string; label: string; sizeBytes: number; installed: boolean }
type TranscriptionErrorCode = 'MODEL_MISSING'|'DISK_FULL'|'FILE_MISSING'|'UNSUPPORTED_LANGUAGE'|'NO_SPEECH'|'DECODE_FAILED'|'INVALID_ARGUMENT'|'ABORTED'|'INTERRUPTED'|'INTEGRITY_FAILED'|'FEATURE_DISABLED'
```

## Rules

- `start` rejects with `INVALID_ARGUMENT` for unknown book, non-audio book, range with `startMs ≥ endMs`, `trackId` not belonging to the book, or `trackId` on a single-file book.
- `start` for a book that already has a queued/running job rejects; a second book is queued.
- `getPassages` clamps `limit` (default 500, max 2000) and returns passages in playback order (chapter `position`, then `startMs`).
- **Feature gate (T033):** while `features.audiobookTranscriptionEnabled` is `false` (the default), `start` and `downloadModel` answer `{ ok: false, errorCode: 'FEATURE_DISABLED' }` first — before validation, the decoder probe, any download or any persisted job. `FEATURE_DISABLED` is never stored (migration 029's `last_error` CHECK does not list it). Reading, `cancel`, `delete` and `removeModel` keep working. `downloadModel` and `start` also check the decoder first and answer `DECODE_FAILED` (not `MODEL_MISSING`) when it is unavailable, so no model is downloaded for a transcription that cannot run; `getInfo.decoder` reports that status to the dialog.
- `getInfo` returns `lastError: 'INTERRUPTED'` for a transcript recovered after a crash/quit; the renderer shows "Resume", which is just `start` with the same scope.
- `downloadModel` verifies every file against the pinned manifest (research R5) and fails with `INTEGRITY_FAILED` without installing anything on mismatch.
- All handlers validate input in Main; DTOs are plain structured-clone objects.
