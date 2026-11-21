# Data model: Faster import that runs in the background (016)

**No migration, no new SQLite table or column.** Everything below is session state in the renderer, the phone's
small queue file, or developer-only timing lines. `books` rows are written exactly as today (FR-007).

## ImportJob (core `app-models/import-queue.ts`)

| Field | Type | Notes |
|---|---|---|
| `id` | string (uuid) | made by the renderer; tags every progress event |
| `batchId` | string \| null | set for jobs from one multi-file pick (FR-011a) |
| `source` | `{ kind: 'pick', pickId }` \| `{ kind: 'url', url }` \| `{ kind: 'cloud', provider, externalId }` \| `{ kind: 'zip', … }` | never a filesystem path; `zip` = the confirmed ZIP preview selection (FR-014) |
| `name` | string | shown name (file name / URL basename / archive name) — user data, never translated |
| `sizeBytes` | number \| null | from the pick; null for a URL until the download knows it |
| `state` | `waiting` \| `running` \| `done` \| `duplicate` \| `failed` \| `cancelled` \| `interrupted` | |
| `step` | `downloading` \| `copying` \| `checking` \| `reading` \| `saving` \| null | only while `running` |
| `stepStartedAt` | number | null | time the current `step` began (set on each step change, null unless `running`); the UI derives the elapsed-seconds counter from it (spec SC-004) |
| `progress` | `{ done: number; total: number \| null }` \| null | bytes; `total` null → indeterminate bar |
| `cancelRequested` | boolean | |
| `bookId` | string \| null | `done`: the new book; `duplicate`: the existing one |
| `error` | `{ code: ImportErrorCode; message: UiText; retryable: boolean }` \| null | `failed` / `interrupted` |
| `queuedAt` | number | ordering (first started, first run — FR-011) |

### State transitions

```text
waiting ──start──▶ running ──ok──▶ done
   │                  ├──dup──▶ duplicate
   │                  ├──err──▶ failed
   │                  ├──cancel (step ≠ saving)──▶ cancelled
   │                  └──host lost (phone relaunch)──▶ interrupted
   ├──cancel──▶ cancelled
   └──pick no longer readable (phone relaunch)──▶ interrupted
failed / interrupted ──Try again──▶ waiting (new id, same source; a lost phone pick re-opens the picker)
done / duplicate / failed / cancelled / interrupted ──Dismiss──▶ removed
```

Rules (pure functions, unit-tested):

- `cancel(job)` is refused while `step === 'saving'` (FR-009); the card shows "Finishing…".
- `nextToRun(queue)` = the oldest `waiting` job; none while one is `running` (FR-011). A ZIP job is just a job (FR-014).
- `retryable` is true for `network`, `timeout`, `http`, `interrupted`, `file_changed`, `save_failed`, `no_space`;
  false for `unsupported_format`, `corrupted`, `inside_app_data`, `duplicate`, `access_denied` (US3 AS5).
- Two jobs for the same file: the second one's duplicate check runs only when it starts, i.e. after the first is
  saved → `duplicate` of it; if the first failed or was cancelled, the second imports normally.

## ImportQueue

`{ jobs: ImportJob[]; batches: Record<batchId, { total: number; notAdded: number }> }` — order = `queuedAt`.

- **Batch summary** `summarizeBatch(queue, batchId)` (FR-011a, clarification 2026-11-21): `{ added, alreadyInLibrary,
  failed: { name, message }[], cancelled, interrupted: { jobId, name }[] }`; groups with 0 are hidden; invariant
  `added + alreadyInLibrary + failed.length + cancelled + interrupted.length === total`. "Open" when `added === 1`.
- **Activity** `activityOf(queue)` = `{ running: 0 | 1, waiting: n }` → Desktop quit guard (FR-013a).

## Placeholder (derived, never stored)

`placeholdersOf(queue)` → `{ jobId, name, state: 'waiting' | 'running', step, percent | null }[]` for jobs that are
`waiting` or `running`. Shown first in the Library "All books" view (Grid / List, both hosts); no menu, cannot be
opened, edited, added to a collection or removed (FR-010).

## Phone queue snapshot (persisted)

File `{Paths.document}/import-queue.json`, written by the host on `importQueue.save` (atomic: temp + move), read once
at launch:

```json
{ "version": 1, "jobs": [ { "id": "…", "batchId": null, "source": { "kind": "pick", "pickId": "…" },
  "name": "Book.pdf", "sizeBytes": 123, "state": "waiting", "queuedAt": 1763700000000 } ] }
```

Only `waiting` / `running` / `failed` / `interrupted` jobs are kept (finished ones are dropped); never file bytes,
never a path. The host keeps `pickId → uri` in the same file's sibling `import-picks.json` (host-only, never sent to
the WebView). Desktop keeps nothing across launches (Key Entities).

## Desktop picked files (Main, memory only)

`picked-files.ts`: `Map<pickId, { path, expiresAt }>` — added by `import:pickFiles`, removed when the job runs or
after 30 min. Same rule as `zip-import/picked-zip.ts`.

## StepTiming (core `perf/step-timing.ts`, developer only)

`{ flow: 'import' | 'open'; step: TimingStep; format: DocumentFormat; sizeBytes: number; ms: number; host:
'desktop' | 'phone'; at: string }` — `TimingStep` = `pick-to-start`, `download`, `copy`, `copy-fallback`,
`fingerprint`, `duplicate-check`, `details`, `signature`, `save`, `cover`, `open-read`, `open-first-page`. No field
can hold a title, file name or path (FR-001).

## Reader opening gate (renderer + Main, memory only)

`readerOpeningStore`: `{ opening: bookId | null; since: number }`; cleared by the first-page signal or after 10 s.
Mirrored to Main by `app:setReaderOpening` for the signature queue and chunking (FR-015).

## Existing data touched

- `books.metadata_json.signatureStatus`: written later (after the background check) — values unchanged.
- `books` / authors / genres: same values, written by the same `persistImportedBook` / `persistImported`.
- Covers: same files under `{userData}/covers/` / phone `covers/{bookId}`; only the moment and the read differ.
