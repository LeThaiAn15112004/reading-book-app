---

description: "Task list for 016 — faster import that runs in the background"
---

# Tasks: Faster import that runs in the background

**Input**: Design documents from `specs/016-faster-background-import/` (plan.md, spec.md, research.md R1–R13,
data-model.md, contracts/import-ipc.md, contracts/phone-host.md, contracts/import-ui.md, quickstart.md)

**Tests**: included — the plan names them: core vitest (`tests/perf/step-timing.test.ts`, `tests/zip/ranged-zip.test.ts`,
`tests/app-models/import-queue.test.ts`, `tests/epub/*`), Mobile vitest (`source/app/platforms/native/tests`), and
Desktop spikes `spike:import:timing|parity|queue|cleanup` (research R12; Desktop has no test runner). **No E2E** (CLAUDE.md).

**Organization**: by user story. US1 → US2 → US3 → US4 is also the required order (plan "Order and risks"): US1's
baseline fixes the SC-002 / SC-009 targets before US2 starts.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1…US4 (spec.md user stories)

## Rules that apply to every task

- No migration, no new SQLite table / column (data-model.md).
- A new IPC method touches the four Desktop places (`platforms/electron/ipc/channels.ts`, `<feature>.ipc.ts`,
  `preload.ts` + `ipc/api-types.ts`, `source/app/bridge/<feature>.ts`) AND the phone bridge (`platforms/native/bridge/*`,
  typed by `Window['api']`).
- Every new or changed Main file gets one line in `source/scripts/desktop-main-changes.json` (`check:desktop-baseline`).
- The renderer never gets a filesystem path (pick ids, book ids, byte ranges only); a referenced user file is only read.
- UI text only through `source/core/src/i18n/catalogue/{en,vi}/*.ts` (`useT()` / `getT()` / `tMain`), Vietnamese per
  `specs/012-app-ui-i18n/contracts/glossary.md`; file names / titles are params. Theme tokens only (`--lib-*`).
- Hook state in zustand stores (project preference).

---

## Phase 1: Setup (shared infrastructure)

**Purpose**: spike folder, script entries, approval list skeleton.

- [ ] T001 Create the spike folder `source/app/platforms/electron/spikes/import/` with a `README.md` stating what each of `run-import-timing.mjs`, `run-import-parity.mjs`, `run-import-queue.mjs`, `run-import-cleanup.mjs` checks (research R12), and add `spike:import:timing`, `spike:import:parity`, `spike:import:queue`, `spike:import:cleanup` to the root `package.json`, following the existing `spike:audio:zip` pattern (`cd source/app/platforms/electron && node --experimental-transform-types --import ./spikes/pdf-annotations/register-alias.mjs spikes/import/run-import-<name>.mjs`)
- [ ] T002 [P] Add approval lines (reason: "016 faster background import") in `source/scripts/desktop-main-changes.json` for every Main file the plan lists: `ipc/import.ipc.ts`, `ipc/picked-files.ts`, `ipc/library.ipc.ts`, `ipc/app.ipc.ts`, `ipc/channels.ts`, `ipc/api-types.ts`, `preload.ts`, `main.ts`, `files/file-hash.ts`, `files/import-sweep.ts`, `files/open-book-content.ts`, `adapters/epub.adapter.ts`, `adapters/filename-fallback-importer.ts`, `signature/signature-queue.ts`, `signature/book-signature.ts`, `background/quit-guard.ts`, `perf/timing-log.ts`, `perf/reader-opening-gate.ts`, `chunking/book-chunk-service.ts`, `wordcount/word-count-service.ts`, `spikes/import/*` (extend the list later if a task touches another Main file)

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: things two or more stories need. ⚠️ No story work until this phase is done.

- [ ] T003 Create the zustand store `source/app/hooks/library/libraryBooksStore.ts` holding the Library book list (`books`, `status`, `load()`, `upsertBook(dto)`, `patchBook(id, patch)`, `removeBook(id)`), moving the state out of `source/app/hooks/library/useLibraryBooks.ts` (which becomes a thin selector hook over the store with the same return shape, so every caller compiles unchanged) — research R8
- [ ] T004 Move the Library list state to `libraryBooksStore` only: `source/app/screens/Library/logic/useLibraryScreen.ts` and the other list consumers read and load through the store (same behaviour, `refreshLibrary()` still reloads the whole list); removing the per-cover `refreshLibrary()` is done in T036, not here
- [ ] T005 [P] Add the error codes `file_changed` and `interrupted` to `ImportResult.errorCode` in `source/app/platforms/electron/ipc/api-types.ts` and the matching core import error code type (find it with `grep -rn "unsupported_format" source/core/src`), plus their texts in `source/core/src/i18n/catalogue/en/import.ts` / `vi/import.ts` ("The file changed or is no longer there" / Vietnamese per glossary) and `main.messages.import.fileChanged` in `source/core/src/i18n/catalogue/{en,vi}/main-messages.ts`
- [ ] T006 [P] Extend the `import:progress` event payload in `source/app/platforms/electron/ipc/api-types.ts` with `jobId?: string`, `step: 'downloading' | 'copying' | 'checking' | 'reading' | 'saving'`, `doneBytes: number`, `totalBytes: number | null`, keeping the old `stage` field for one release (contracts/import-ipc.md "Changed"); mirror the type in `source/app/platforms/native/bridge/dto.ts`

**Checkpoint**: list state is a store, error codes and progress shape exist on both hosts — `npm run typecheck` green.

---

## Phase 3: User Story 1 — Know where the time goes (Priority: P1) 🎯 MVP

**Goal**: developer-only per-step timing of import and open on both hosts; a baseline report.

**Independent test**: `READMATE_TIMING=1 npm run dev`, import + open each sample → `{userData}/logs/timing.jsonl` has a
line per FR-002 step with format, size, ms only; without the variable no file is created (quickstart §1).

### Tests for User Story 1

- [ ] T007 [P] [US1] Write `source/core/tests/perf/step-timing.test.ts`: off → the timer is a no-op (no record, `end()` returns nothing); on → one `StepTiming` per step with `ms ≥ 0`; `formatTimingLine` output is one JSON line whose keys are exactly `flow, step, format, sizeBytes, ms, host, at` (no title / file name / path field can exist — US1 AS4); unknown step names do not compile (type test)

### Implementation for User Story 1

- [ ] T008 [US1] Create `source/core/src/perf/step-timing.ts`: `StepTiming = { flow: 'import' | 'open'; step: TimingStep; format: DocumentFormat; sizeBytes: number; ms: number; host: 'desktop' | 'phone'; at: string }`, `TimingStep` = `'pick-to-start' | 'download' | 'copy' | 'copy-fallback' | 'fingerprint' | 'duplicate-check' | 'details' | 'signature' | 'save' | 'cover' | 'open-read' | 'open-first-page'` (data-model.md verbatim), `createStepTimer({ enabled, host, now, sink })` (injected clock + sink; no Node / DOM global — R1), `formatTimingLine(t)`; export from `source/core/src/index.ts`
- [ ] T009 [P] [US1] Create `source/app/platforms/electron/perf/timing-log.ts`: `isTimingEnabled()` = `process.env.READMATE_TIMING === '1'`; `appendTimingLine(t)` appends to `{userData}/logs/timing.jsonl` (creates `logs/` lazily, only when enabled — off leaves no file); a `mainTimer` built with `createStepTimer({ host: 'desktop' })`
- [ ] T010 [US1] Add `app:getTimingEnabled` and `app:recordTiming` (contracts/import-ipc.md: `getTimingEnabled(): Promise<boolean>`, `recordTiming(line: StepTimingDto): Promise<OkResult>` — ignored unless timing is on; Main re-validates the line's shape and drops unknown keys) in `ipc/channels.ts` (`AppChannels`), `ipc/app.ipc.ts`, `ipc/api-types.ts`, `preload.ts`, `source/app/bridge/app.ts`
- [ ] T011 [P] [US1] Phone side of T010 in `source/app/platforms/native/bridge/app.ts`: `getTimingEnabled()` = development build AND `localStorage['readmate.devTiming'] === '1'` (try/catch); `recordTiming` → `console.info('[timing]', line)` + keep the last 500 in `window.__readmateTiming`
- [ ] T012 [US1] Create the renderer timer `source/app/hooks/app/stepTimer.ts` (module-level, asks `getTimingEnabled()` once, then `createStepTimer({ sink: recordTiming })`; no-op until the answer arrives)
- [ ] T013 [US1] Time the Desktop import steps with `mainTimer`: `pick-to-start`, `download`, `fingerprint`, `duplicate-check`, `details`, `signature`, `save` in `source/app/platforms/electron/ipc/import.ipc.ts`, `adapters/filename-fallback-importer.ts`, `signature/book-signature.ts` (format + size only)
- [ ] T014 [US1] Measure SC-003 and SC-004 on Desktop and the phone: SC-003 = time from the file chosen (picker / menu closed) until the reader can navigate on screen, must be < 1 s; SC-004 during an import of a file > 300 MB = largest gap between two progress updates ≤ 2 s (on the phone, a step without intermediate percentages counts when a continuous animation + an elapsed-seconds counter is shown — spec SC-004) and input latency (click / tap / key → handled) ≤ 200 ms; record the method and the figures in `specs/016-faster-background-import/timing-baseline.md`
- [ ] T015 [US1] Time `open-read` in `source/app/platforms/electron/files/open-book-content.ts` (Main) and `cover` in `source/app/screens/Library/logic/generateBookCover.ts` (renderer, `stepTimer`)
- [ ] T016 [US1] Time `open-first-page` in the renderer: start when the Reader begins loading a book, end on the first drawn page — EPUB first section `rendered`, PDF page-1 `render` resolved, TXT / MD first paint — in the renderers under `source/app/components/reader/renderers/{epub,pdf,txt,md}/` via one helper `markFirstPageDrawn(bookId)` in `source/app/hooks/reader/firstPageSignal.ts` (reused by US4)
- [ ] T017 [P] [US1] Time the phone steps `copy`, `fingerprint` in `source/app/platforms/native/host/file-service.ts` (host → returned with the result as `timings`) and `duplicate-check`, `details`, `save` in `source/app/platforms/native/bridge/import.ts`, all sent through `recordTiming`
- [ ] T018 [US1] Measure the native phone copy and fingerprint on a real device before US2 is closed (research R5 risk): a throw-away dev-build check that runs `new File(uri).copy(...)` and `file.digest('SHA-256')` on a file > 100 MB picked through `content://`, records MB/s for each next to today's JS loop, and writes the figures into `specs/016-faster-background-import/timing-baseline.md` (device named)
- [ ] T019 [US1] Write `source/app/platforms/electron/spikes/import/run-import-timing.mjs`: reads `timing.jsonl` (path from `--file` or the dev userData), groups by format + size bucket + step, prints a before / after table, `--label <name>` tags a run, and FAILS if any line has a key outside the `StepTiming` fields (US1 AS4)
- [ ] T020 [US1] Run the baseline (quickstart §1, Desktop + phone dev build) on the sample set and write `specs/016-faster-background-import/timing-baseline.md` (samples named by format + size only, machine / device named); then, per the 2026-11-21 clarification, either confirm 40 % / 30 % or write the lowered figure and its reason under SC-002 / SC-009 in `specs/016-faster-background-import/spec.md` — **this decision closes US1 and is a gate for US2**
- [ ] T021 [US1] Capture the current pipeline's output before any US2 change: import the sample set with today's code into a temp DB on the migrated schema and write each `books` row (title, author, format, size, page count, description, genres, sha256, signatureStatus) plus the SHA-256 of its cover file to `source/app/platforms/electron/spikes/import/fixtures/baseline-rows.json` (samples identified by format + size, no file name / path — FR-001); this file is the reference T042 compares against

**Checkpoint**: baseline table exists, targets fixed. `npm run sdk:test` green.

---

## Phase 4: User Story 2 — Import without doing the same work twice (Priority: P1)

**Goal**: one fingerprint per import, EPUB unpacked once by ranges, PDF signature after saving, covers without the
whole book and without a whole-list reload — same library entry as before (FR-007).

**Independent test**: `npm run spike:import:parity` (rows + cover hashes identical old vs new) and
`npm run spike:import:timing -- --label after` meets the SC-002 figure from T020 (quickstart §2).

### Tests for User Story 2

- [ ] T022 [P] [US2] Write `source/core/tests/zip/ranged-zip.test.ts` with in-memory `RandomAccessSource` + a Node `zlib.inflateRawSync` inflate injected by the test: stored and deflate entries, ZIP64 EOCD, EOCD comment up to 64 KiB, truncated file, limits "entries ≤ 20 000, central directory ≤ 16 MiB, one entry ≤ 32 MiB" → `EPUB_MALFORMED`, only the requested entries' ranges are read (count `read()` calls / bytes)
- [ ] T023 [P] [US2] Extend `source/core/tests/epub/` with a test that runs the existing `readEpubImportMetadata` (`source/core/src/epub/epub-package.ts`) on `openRangedZip(...)` and on the current JSZip-based reader for the same fixture and expects equal output (title, author, description, genres, cover bytes)
- [ ] T024 [P] [US2] Extend `source/app/platforms/native/tests/host-services.test.ts` (and `fake-host.ts`): `files.stage` uses `HostFs.copyUri` (no `readBytesSync` loop), falls back to the chunked loop on `InvalidPermission…` (one file only), emits `copying` progress from size polling, honours cancel after `copy()` resolves (staging removed, `CANCELLED`); `files.hashStaged` uses `HostFs.digest` and returns lowercase hex + size; `files.readRange` bounds (`length ≤ 1 MiB`)
- [ ] T025 [P] [US2] Extend `source/app/platforms/native/tests/import.test.ts`: an EPUB import reads details + cover through ranges (no whole-file `content.read`), result equals the old path's result

### Implementation for User Story 2 — core

- [ ] T026 [US2] Create `source/core/src/zip/ranged-zip.ts`: `RandomAccessSource = { size: number; read(offset, length): Promise<Uint8Array> }`, `InflateRaw = (data: Uint8Array) => Promise<Uint8Array> | Uint8Array`, `openRangedZip(source, inflate): Promise<ArchiveReader>` implementing the existing port in `source/core/src/ports/archive.ts`: EOCD in the last ≤ 64 KiB + 22 B, ZIP64 EOCD, central directory, then per requested entry local header + data; stored / deflate only; limits "entries ≤ 20 000, central directory ≤ 16 MiB, one entry ≤ 32 MiB" → `EPUB_MALFORMED` (research R4); export from `source/core/src/index.ts`
- [ ] T027 [US2] Add the optional second argument to `DocumentImporter.import(filePath, options?: { known?: { sha256: string; fileSizeBytes: number } })` in `source/core/src/domain-ports/document-importer.ts`; keep every existing caller compiling

### Implementation for User Story 2 — Desktop

- [ ] T028 [US2] `source/app/platforms/electron/files/file-hash.ts`: `hashFile(path, { signal?: AbortSignal; onProgress?: (done, total) => void })` (stream, `highWaterMark` 1 MiB, abort → reject `CANCELLED`); existing callers unchanged
- [ ] T029 [US2] `source/app/platforms/electron/adapters/filename-fallback-importer.ts`: `buildImportResult` uses `options.known` when given instead of hashing again (research R2)
- [ ] T030 [US2] `source/app/platforms/electron/ipc/import.ipc.ts` `importFromFile`: `stat` → ONE `hashFile` → `findBySha256` (duplicate) → importer with `known` → `stat` again before saving; size or `mtimeMs` differs → `file_changed`, nothing added (spec edge case) → `persistImportedBook`
- [ ] T031 [US2] `source/app/platforms/electron/adapters/epub.adapter.ts`: read container / OPF / cover through `openRangedZip` with a source over `fs.promises.open` + `read` and `zlib.inflateRawSync`, feeding the existing `parseContainerRootfile` / `parseOpf` / `extractCover`; this replaces the old `readFile` + `JSZip` import path directly (FR-004) — no spike switch keeps it, parity is checked against `fixtures/baseline-rows.json` (T042); JSZip stays for reader / chunking
- [ ] T032 [US2] Create `source/app/platforms/electron/signature/signature-queue.ts`: `scheduleSignatureCheck(bookId)` — in-memory FIFO, one check at a time, runs `checkBookSignature`, writes via `saveSignature` only if the book still exists AND its `sha256` is unchanged; failure / interruption writes nothing ("not checked yet", never `unsigned`) — research R3; expose a `waitWhile(predicate)` hook used by US4
- [ ] T033 [US2] Remove the `verifyOnImport` call before `persistImportedBook` (in `source/app/platforms/electron/signature/book-signature.ts` / `ipc/import.ipc.ts`) and call `scheduleSignatureCheck(bookId)` after the PDF row is written, for file, URL and cloud imports — the pre-save check is removed outright (FR-005), no spike switch keeps it
- [ ] T034 [US2] Add `library:getCoverSource(bookId)` and `library:readBookRange({ bookId, offset, length })` (contracts/import-ipc.md verbatim: text `≤ 4 000 chars` — TXT / MD from the first 64 KiB, EPUB first spine document with text through the ranged reader; PDF → `{ kind: 'pdf', sizeBytes }`; errors `not_found | missing_file | path_denied | read_failed | nothing_to_render`; range rules "`offset ≥ 0`, `1 ≤ length ≤ 1 048 576`, `offset + length ≤ size` (else `range`)", file through `resolveBookFile`, audio formats refused) in `ipc/channels.ts` (`LibraryChannels`), `ipc/library.ipc.ts`, `ipc/api-types.ts`, `preload.ts`, `source/app/bridge/library.ts`
- [ ] T035 [US2] Change `library:setGeneratedCover` to return `{ ok: true, coverUrl } | { ok: false }` in `ipc/library.ipc.ts`, `ipc/api-types.ts`, `source/app/bridge/library.ts` and the phone `source/app/platforms/native/bridge/library.ts`

### Implementation for User Story 2 — shared UI

- [ ] T036 [US2] Rewrite `source/app/screens/Library/logic/generateBookCover.ts`: `getCoverSource` → text cover drawn from the text; PDF → pdf.js `getDocument({ range: PDFDataRangeTransport, disableAutoFetch: true, disableStream: true })` whose ranges come from `readBookRange` (≤ 1 MiB each), page 1 only; no `openBookContent`; after `setGeneratedCover` call `libraryBooksStore.patchBook(id, { coverUrl })` — no `refreshLibrary()` per cover (FR-006, US2 AS4)

### Implementation for User Story 2 — phone

- [ ] T037 [P] [US2] `source/app/platforms/native/host/expo-host-fs.ts`: add `HostFs.copyUri(uri, rel)` = `await new File(uri).copy(appFile(rel))`, `HostFs.digest(rel)` = `await appFile(rel).digest('SHA-256')` (lowercase hex), `HostFs.readRange(rel, offset, length)`
- [ ] T038 [US2] `source/app/platforms/native/host/file-service.ts` (replaces the JS `readBytesSync` → `writeBytes` stage loop and the JS `Sha256` hash directly — FR-003; the chunked loop survives only as the per-file fallback below, no spike switch): `files.stage` → `copyUri` with 250 ms `fileSize` polling → `copying` progress, `NO_SPACE` check before copying unchanged, refusal `InvalidPermission…` → today's chunked loop for this file only (timing step `copy-fallback`), cancel honoured when `copy()` resolves; `files.hashStaged` → `digest`, one `checking` event `total: null`; new `files.readRange { bookId, offset, length ≤ 1 MiB }` → base64 of `books/{bookId}/file` (contracts/phone-host.md); register in `source/app/platforms/native/host/rpc.ts`
- [ ] T039 [US2] `source/app/platforms/native/bridge/import.ts`: after `commitStaged`, read EPUB details + cover with `openRangedZip` over a source that uses local-server `Range` requests (`206`, per-launch token) or, in Expo Go, `files.readRange`; inflate = `DecompressionStream('deflate-raw')`, and when it is missing (Chromium < 103) inflate only the needed entries' bytes with the existing JSZip; cover written with `files.writeCover`; no whole-file `content.read` during import (FR-004a)
- [ ] T040 [P] [US2] `source/app/platforms/native/bridge/library.ts`: `getCoverSource` and `readBookRange` with the same types as Desktop (host reads ranges by path; PDF ranges by local-server `Range`)
- [ ] T041 [P] [US2] Update `specs/008-shared-core-architecture/contracts/host-services.md` with the `files.stage` / `files.hashStaged` / `files.readRange` changes

### Verification for User Story 2

- [ ] T042 [US2] Write `source/app/platforms/electron/spikes/import/run-import-parity.mjs`: import the sample set (`--samples <dir>`) with the new pipeline into a temp DB on the migrated schema and compare each `books` row field by field (title, author, format, size, page count, description, genres, sha256) and its cover file SHA-256 with `spikes/import/fixtures/baseline-rows.json` (T021); any difference fails; also: importing the same file twice → `duplicate` (US2 AS5); PDF row has no `signatureStatus` right after saving and gets one after the queue runs
- [ ] T043 [US2] Run `npm run spike:import:parity` and `npm run spike:import:timing -- --label after` (+ the phone timings) and add the "after" table to `specs/016-faster-background-import/timing-baseline.md`; SC-002 / SC-009 must meet the figure fixed in T020

**Checkpoint**: same rows, fewer reads; `npm run sdk:test`, `npm run mobile:test`, `npm run typecheck` green.

---

## Phase 5: User Story 3 — Keep using the app while a book imports (Priority: P1)

**Goal**: non-blocking import with one shared queue, multi-file pick (≤ 50), progress card / pill on every screen,
Library placeholders, batch summary, ZIP jobs in the same queue, Desktop quit guard + startup sweep, phone queue kept
across launches.

**Independent test**: quickstart §3 — pick 5 samples, keep reading / browsing; cancel waiting / running; "Finishing…"
in Saving; summary adds up; 51 files → 50 queued; quit dialog; phone relaunch → "Interrupted".

### Tests for User Story 3

- [ ] T044 [P] [US3] Write `source/core/tests/app-models/import-queue.test.ts`: every transition of data-model.md's diagram; `cancel` refused while `step === 'saving'`; `nextToRun` = oldest `waiting`, none while one is `running`; `retryable` true for `network, timeout, http, interrupted, file_changed, save_failed, no_space` and false for `unsupported_format, corrupted, inside_app_data, duplicate, access_denied`; `summarizeBatch` invariant `added + alreadyInLibrary + failed.length + cancelled + interrupted.length === total` and zero groups hidden, "Open" only when `added === 1`; `placeholdersOf` only `waiting` / `running`; `activityOf`; snapshot keeps only `waiting | running | failed | interrupted`, restore turns `running` → `interrupted`; Try again = new id, same source
- [ ] T045 [P] [US3] Add a Mobile vitest `source/app/platforms/native/tests/import-queue.test.ts`: `importQueue.save` / `load` round trip (temp + move), limits "≤ 200 jobs, ≤ 256 KiB, else `INVALID_ARGUMENT`", no bytes / path in the WebView-side snapshot, `import-picks.json` entries without a job dropped at startup, `files.checkPick` readable / not readable
- [ ] T046 [P] [US3] Write `source/app/platforms/electron/spikes/import/run-import-queue.mjs`: the real `importQueueStore` with a scriptable `importApi` — FIFO order, cancel waiting, cancel running, Saving not cancellable ("Finishing…"), a second import waits, two jobs of the same file → second is `duplicate`, batch summary counts, a `zip` job runs in the same queue, `onCancelAll`, snapshot restore → `interrupted` + waiting continue; plus a real-file scenario (C2): pick 20 books at once on Desktop and on the phone (development build), let the batch end, and check that the five summary groups add up to 20 and match the actual `books` table (rows added, already present, absent for failed / cancelled / interrupted); plus a hidden-window run (C5): with Run in Background on and the window hidden, import a large sample and compare its total time and progress-event gaps with the same import in a visible window, to see whether Chromium `backgroundThrottling` slows the renderer runner (record the figures in `timing-baseline.md`)
- [ ] T047 [P] [US3] Write `source/app/platforms/electron/spikes/import/run-import-cleanup.mjs` (SC-006): 20 runs of cancel at each step / injected failure (incl. `ENOSPC` during a URL download) / child process killed mid-import, then `sweepImportLeftovers()` → 0 rows, 0 `{userData}/books/{uuid}` copies, 0 covers left, sources' SHA-256 unchanged

### Implementation for User Story 3 — core

- [ ] T048 [US3] Create `source/core/src/app-models/import-queue.ts` with the exact `ImportJob` fields of data-model.md (`id`, `batchId`, `source: { kind: 'pick', pickId } | { kind: 'url', url } | { kind: 'cloud', provider, externalId } | { kind: 'zip', … }` — never a filesystem path, `name`, `sizeBytes`, `state`, `step`, `progress: { done; total: number | null } | null`, `cancelRequested`, `bookId`, `error: { code; message: UiText; retryable } | null`, `queuedAt`), `ImportQueue = { jobs; batches: Record<batchId, { total; notAdded }> }`, pure functions `enqueue`, `start`, `progress`, `finish`, `fail`, `cancel`, `retry`, `dismiss`, `clearFinished`, `nextToRun`, `summarizeBatch`, `placeholdersOf`, `activityOf`, `toSnapshot` / `fromSnapshot` (`version: 1`); export from `source/core/src/app-models/index.ts`

### Implementation for User Story 3 — i18n

- [ ] T049 [P] [US3] Add the `queue.*` keys of contracts/import-ui.md to `source/core/src/i18n/catalogue/en/import.ts` and `vi/import.ts` (`queue.step.{downloading,copying,checking,reading,saving}`, `queue.waiting` {count}, `queue.cancel`, `queue.finishing`, `queue.open`, `queue.openExisting`, `queue.tryAgain`, `queue.dismiss`, `queue.clearFinished`, `queue.summary.{added,already,failed,cancelled,interrupted}` as `{ one, other }`, `queue.tooMany` {count}, `queue.zipAlone`, `queue.placeholder.{importing,waiting}`, `queue.pill` {current,total,percent}, `queue.interrupted`) and `main.messages.import.quitConfirm.{title,message,quit,cancel}` ({count}) and `main.messages.import.busy` ("Another import is still running", returned by `import:runJob` when another import runs) to `{en,vi}/main-messages.ts`; Vietnamese per glossary (no "bạn")

### Implementation for User Story 3 — Desktop Main

- [ ] T050 [US3] Create `source/app/platforms/electron/ipc/picked-files.ts`: `Map<pickId, { path, expiresAt }>`, entries removed when used or after 30 min (same rule as `zip-import/picked-zip.ts`)
- [ ] T051 [US3] Add `import:pickFiles` in `ipc/import.ipc.ts`: dialog `['openFile', 'multiSelections']`, first 50 in picker order kept in `picked-files.ts`, answer `{ status: 'picked', items: { pickId, name, sizeBytes, kind: 'book' | 'zip' | 'unsupported', format? }[] /* ≤ 50 */, notAdded }` or `{ status: 'cancelled' }` (a single picked ZIP still offers today's `audiobook_zip` route via `picked-zip.ts`); wire `ipc/channels.ts`, `ipc/api-types.ts`, `preload.ts`, `source/app/bridge/import.ts`
- [ ] T052 [US3] Add `import:runJob({ jobId, pickId })` and `import:cancelJob({ jobId })` in `ipc/import.ipc.ts`: steps `checking` (hash with progress + `AbortSignal`) → `reading` → `saving` (not cancellable; `cancelJob` answers `{ ok: false, reason: 'saving' }`) → `scheduleSignatureCheck`; progress events tagged with `jobId` + `step` + bytes; one run at a time (a concurrent call → `save_failed` "Another import is still running"); cancel before saving aborts the stream and removes the extracted cover, never touches a referenced file; `import:fromFile` kept, routed through the same runner; wire the four places
- [ ] T053 [US3] Give `import:fromUrl` and `cloud:downloadAndImport` an optional `jobId` (progress tagged, cancel by `cancelJob`, partial download removed on cancel / `no_space`) in `ipc/import.ipc.ts`, `ipc/cloud.ipc.ts`, `ipc/api-types.ts`, `preload.ts`, `source/app/bridge/import.ts`, `source/app/bridge/cloud.ts` (approval line for `cloud.ipc.ts` in T002's file)
- [ ] T054 [US3] Add `import:reportActivity({ running, waiting })` and the Main → renderer event `import:cancelAll` (`onCancelAll(cb)` in preload + `source/app/bridge/import.ts`)
- [ ] T055 [US3] Create `source/app/platforms/electron/background/quit-guard.ts` with pure `decideQuit({ pending, confirmed, shuttingDown })` and the dialog flow (Main-owned `dialog.showMessageBox`, texts via `tMain` `quitConfirm.*` naming the count; Quit → send `import:cancelAll`, wait ≤ 3 s, then `quitApp()`); wire it in `source/app/platforms/electron/main.ts` into `before-quit` and the window `close` handler when `shouldHideOnClose()` is false, keeping the `isQuitting` flag rules of `background/background-mode.ts`; `query-session-end` / `session-end` never ask (FR-013a)
- [ ] T056 [US3] Create `source/app/platforms/electron/files/import-sweep.ts` `sweepImportLeftovers()`: removes `{userData}/books/{uuid}` folders without a `books` row and `covers/*` files no row references (same rule as `removeManagedBookDir` in `files/sandbox.ts`, never outside the sandbox) and `reading-book-*` temp folders older than 1 h; call it at startup in `main.ts` before `registerAllIpcHandlers()`

### Implementation for User Story 3 — shared queue + UI

- [ ] T057 [US3] Create `source/app/hooks/library/importQueueStore.ts` (module-level zustand, both hosts): state = core `ImportQueue`; actions `addPicked(items, notAdded)`, `addUrl`, `addCloud`, `addZip(selection)`, `cancel(jobId)`, `retry(jobId)` (a lost phone pick re-opens the picker), `dismiss`, `clearFinished`; one runner that calls `importApi.runJob` / `fromUrl` / `cloud.downloadAndImport` / `zipImport.confirm` for `nextToRun`, applies progress events by `jobId`, on `done` calls `libraryBooksStore.upsertBook`, reports `reportActivity` on every change, handles `onCancelAll`, and on the phone saves the snapshot after each change (T069)
- [ ] T058 [US3] `source/app/hooks/library/useLibraryImport.ts` + `source/app/hooks/library/libraryImportStore.ts`: Add file → `pickFiles` → `addPicked` (menu closes at once, SC-003); `notAdded > 0` → toast `queue.tooMany`; a `zip` item inside a multi-pick is left out + toast `queue.zipAlone`; a `kind: 'unsupported'` item becomes a job created directly in state `failed` (`error.code: 'unsupported_format'`, `retryable: false`) and IS counted in the batch summary's "failed" group; URL / cloud → enqueue; remove `busy` refusal of a second import
- [ ] T059 [US3] `source/app/hooks/library/zipImportStore.ts`: pressing Import in the preview enqueues a `zip` job (`addZip`) instead of running its own job; when the runner starts it, it calls the existing `zipImport:confirm` and maps each existing `zipImport:progress` event (`ZipImportProgress = { stage: 'extracting' | 'saving'; done; total; name? }`) onto `progress(jobId)` of that ZIP job — `stage: 'extracting'` → step `copying` with `progress = { done, total }` (tracks), `stage: 'saving'` → step `saving` (Cancel disabled, "Finishing…"); the card's Cancel on a ZIP job calls the existing `zipImport:cancelImport` (`zipImportStore.cancelJob`); the result (`done`, `bookId` = the audiobook) shows "Open audiobook"; `source/app/components/import/AudiobookZipJobPanel.tsx` stays for the ZIP result (track list + "Open audiobook"), opened from the ZIP job's row (FR-014)
- [ ] T060 [P] [US3] Create `source/app/components/import/ImportQueueCard.tsx` (no modal / backdrop): running job name, `queue.step.*`, bar (percentage when `total` known, else indeterminate; `motion-safe`, reduced motion = static bar + number), `queue.waiting`, Cancel → disabled `queue.finishing` during `saving`; collapsed 44 px pill `queue.pill` opening the card in one action; Esc collapses; `aria-live="polite"` region for step changes; theme tokens only
- [ ] T061 [P] [US3] Create `source/app/components/import/ImportQueueList.tsx` (waiting: Cancel; running; done: Open; duplicate: Open existing; failed: cause + Try again when `retryable` + Dismiss; cancelled; interrupted: Try again; Clear finished) and `source/app/components/import/ImportBatchSummary.tsx` (five groups hidden at 0, failure causes, Open when exactly one added)
- [ ] T062 [P] [US3] Create `source/app/components/import/ImportPlaceholderTile.tsx` and `ImportPlaceholderRow.tsx`: neutral cover with spinner, name (user data), `queue.placeholder.importing` with percent / `queue.placeholder.waiting`; `aria-disabled`, no menu, not a book link, announced "Importing {name}"
- [ ] T063 [US3] Mount the card / pill in `source/app/App.tsx` above every route; delete `source/app/components/import/ImportProgressDialog.tsx` and its uses; success / duplicate / failure toasts through `source/app/components/import/ImportToast.tsx` with Open / Open existing, announced without moving focus (FR-012)
- [ ] T064 [US3] Render placeholders first in the "All books" view only (Grid + List; not Collections, other chips, search) in `source/app/screens/Library/LibraryHub.tsx` and `source/app/screens/Library/phone/MobileLibraryHub.tsx` from `placeholdersOf(queue)`
- [ ] T065 [P] [US3] Placement: Desktop bottom-right 16 px, width 360 px, z-index below dialogs, clear of the Reader page-turn zone (card CSS in `source/app/styles/`); phone rules under `[data-mobile-host]` in `source/app/styles/phone.css`: full width minus 16 px gutters, above `PhoneNav` and `env(safe-area-inset-bottom)`, targets ≥ 44 × 44; expanded card closed by `useBackClose` (`source/app/hooks/app/useBackClose.ts`), Back never cancels (US3 AS10)

### Implementation for User Story 3 — phone host + bridge

- [ ] T066 [US3] `source/app/platforms/native/host/expo-host-fs.ts` + `file-service.ts`: `files.pick { extensions, multiple?: boolean }` → `DocumentPicker.getDocumentAsync({ multiple: true })`, answer `{ status: 'picked', items: [{ pickId, name, size, extension | null }], notAdded }` (first 50 in picker order), single-file shape kept when `multiple` is absent; `pickId → uri` kept host-side; new `files.checkPick { pickId } → { readable }` (`new File(uri).exists` + 1-byte open-read); register in `host/rpc.ts`
- [ ] T067 [US3] Create `source/app/platforms/native/host/import-queue-file.ts`: `importQueue.load` / `importQueue.save` on `Paths.document/import-queue.json` (temp + move), `import-picks.json` sibling (host-only), limits "≤ 200 jobs, ≤ 256 KiB, else `INVALID_ARGUMENT`"; startup order: existing staging sweep → drop `import-picks.json` entries without a job → WebView loads (wire in `host/host-runtime.ts` / `host/lifecycle.ts`)
- [ ] T068 [US3] Phone bridge: `pickFiles`, `runJob` (`files.stage` → `files.hashStaged` → write queue `findBySha256` → `commitStaged` → ranged EPUB details + cover → `persistImported`, progress tagged by `jobId`), `cancelJob`, `reportActivity` / `onCancelAll` no-ops in `source/app/platforms/native/bridge/import.ts`; new `source/app/platforms/native/bridge/import-queue.ts` (`load`, `save`, `checkPick`) registered in `bridge/index.ts` / `create-api` so `Window['api']` is complete
- [ ] T069 [US3] Phone relaunch in `importQueueStore.ts`: on start call `importQueue.load`; `running` → `interrupted`; each `waiting` → `checkPick` → readable stays waiting and runs in order, not readable → `interrupted` (Try again opens the picker); entries leave the snapshot when finished or dismissed (FR-013b)

**Checkpoint**: quickstart §3 passes on Desktop and phone; `spike:import:queue`, `spike:import:cleanup`,
`npm run mobile:test`, `npm run lint` (incl. `readmate/no-ui-literals`) green.

---

## Phase 6: User Story 4 — Opening is not slowed by background work (Priority: P2)

**Goal**: indexing, word count, signature check, cover drawing and the import runner wait until the first page is drawn
(≤ 10 s).

**Independent test**: quickstart §4 — `open-first-page` with an import running ≤ 20 % over the idle open, right after
import ≤ 5 % over baseline; `bookIndex:ensure` appears only after `open-first-page`.

- [ ] T070 [US4] Create `source/app/hooks/reader/readerOpeningStore.ts`: `{ opening: bookId | null; since: number }`, `begin(bookId)` when the Reader starts loading, `clear()` from `markFirstPageDrawn` (T016) or after 10 s; mirrors every change to Main via `app:setReaderOpening`
- [ ] T071 [US4] Add `app:setReaderOpening({ bookId: string | null })` (four Desktop places: `ipc/channels.ts`, `ipc/app.ipc.ts`, `ipc/api-types.ts`, `preload.ts`, `source/app/bridge/app.ts`) backed by `source/app/platforms/electron/perf/reader-opening-gate.ts` (`isOpening()`, `waitUntilOpened()` bounded by 10 s); phone `source/app/platforms/native/bridge/app.ts` keeps it renderer-only (no-op host call)
- [ ] T072 [US4] `source/app/screens/Reader/logic/hooks/useBookIndexing.ts`: start chunking / word count after the first page is drawn (store cleared), not at `contentStatus === 'ready'`
- [ ] T073 [US4] Make `source/app/platforms/electron/signature/signature-queue.ts`, the Main chunk service `source/app/platforms/electron/chunking/book-chunk-service.ts` and the word count service `source/app/platforms/electron/wordcount/word-count-service.ts` wait on `reader-opening-gate.ts` before starting a check / chunking
- [ ] T074 [US4] Make `importQueueStore.ts` (between steps / before the next job) and `generateBookCover.ts` wait while `readerOpeningStore.opening` is set (max 10 s); in `files/file-hash.ts` yield with `setImmediate` between 1 MiB chunks while `isOpening()` (research R9)
- [ ] T075 [US4] Measure per quickstart §4 and add the SC-005 figures to `specs/016-faster-background-import/timing-baseline.md`

**Checkpoint**: SC-005 met; nothing starts on the opening book before its first page.

---

## Phase 7: Polish & cross-cutting concerns

- [ ] T076 [P] Write the feature map `docs/implementation_plan/faster_background_import.md` (files, channels, queue rules, spikes, targets) and add a short "Background import (spec 016)" paragraph to `CLAUDE.md` (queue in the renderer, pick ids, ranged ZIP reader, signature after saving, quit guard + sweep, phone snapshot, spikes `spike:import:*`) plus the new spike names in its Commands list
- [ ] T077 [P] Run `npm run i18n:inventory` and make sure no `i18n-pending` marker is left for the `import` area; Vietnamese texts checked against `specs/012-app-ui-i18n/contracts/glossary.md` (`tests/i18n/glossary-anchors.test.ts`)
- [ ] T078 [P] Contrast / keyboard pass on the card, pill, list and placeholders in light + dark themes (text ≥ 4.5 : 1, Tab order pill → actions, Esc collapses) — FR-017
- [ ] T079 Once `spike:import:parity` and the timing benchmark pass, clean up the temporary spike files / scripts in `source/app/platforms/electron/spikes/import/` (one-off measurement helpers, the T018 device check, scratch outputs), keeping the four `spike:import:*` scripts and `fixtures/baseline-rows.json`; update `spikes/import/README.md` and the root `package.json` accordingly
- [ ] T080 Make sure every Main file actually touched is listed in `source/scripts/desktop-main-changes.json`, then run `npm run check` (typecheck, lint, core + mobile tests, boundaries, platform-adapters, builds, build-split, `check:desktop-baseline`) — must be green
- [ ] T081 Run `specs/016-faster-background-import/quickstart.md` on Desktop and an Android development build and write the acceptance results (pass / fail per step, with figures) in `specs/016-faster-background-import/timing-baseline.md`

---

## Dependencies & execution order

### Phase dependencies

- **Setup (1)** → **Foundational (2)** → **US1 (3)** → **US2 (4)** → **US3 (5)** → **US4 (6)** → **Polish (7)**
- US1 → US2 is a hard gate (T020 fixes SC-002 / SC-009 before US2 starts — clarification 2026-11-21). T018 (native
  copy / digest on a device) and T021 (`fixtures/baseline-rows.json` from today's pipeline) must also be done before the
  first US2 code change: T042 compares against T021's file.
- US3 needs `libraryBooksStore` (T003) and, for the phone runner, the native stage / digest / ranged EPUB of US2
  (T037–T039). Desktop US3 needs T028 (hash progress + abort) and T030 (hash once).
- US4 needs T016 (first-page signal), T032 (signature queue) and T057 (runner).

### Within each story

- Tests first (they fail), then core → Main / host → bridge → UI.
- T026 before T031 / T039; T027 before T029; T032 before T033; T034 before T036 / T040; T048 before T057;
  T050 before T051–T052; T057 before T058–T064, T069; T066–T067 before T068–T069.

### Parallel opportunities

- Setup: T001 ∥ T002. Foundational: T005 ∥ T006 (after T003 / T004 or alongside).
- US1: T007 ∥ T009 ∥ T011 ∥ T017 once T008 exists.
- US2: tests T022–T025 together; T037 ∥ T040 ∥ T041 alongside the Desktop tasks.
- US3: T044–T047 together; T049 ∥ T050; UI components T060 ∥ T061 ∥ T062 ∥ T065; phone T066–T067 alongside Desktop
  T050–T056.

## Parallel example: User Story 3

```text
Task: "T044 import-queue.test.ts in source/core/tests/app-models/"
Task: "T045 import-queue.test.ts in source/app/platforms/native/tests/"
Task: "T046 run-import-queue.mjs in source/app/platforms/electron/spikes/import/"
Task: "T047 run-import-cleanup.mjs in source/app/platforms/electron/spikes/import/"

# after T057:
Task: "T060 ImportQueueCard.tsx"
Task: "T061 ImportQueueList.tsx + ImportBatchSummary.tsx"
Task: "T062 ImportPlaceholderTile.tsx + ImportPlaceholderRow.tsx"
```

## Implementation strategy

1. **MVP = Setup + Foundational + US1**: the baseline report and fixed targets — nothing user-visible changes, but every
   later figure is measured against it.
2. **+ US2**: faster imports with identical rows (parity spike green) — shippable on its own.
3. **+ US3**: the user's explicit request (background import, queue, multi-file) — shippable on its own; Desktop first,
   then the phone host tasks.
4. **+ US4**: small, last.
5. Polish; `npm run check` green before every push.

## Notes

- `[P]` = different files, no dependency on an unfinished task.
- Commit after each task or logical group; stop at any checkpoint to validate the story on its own.
- E2E is never run as routine verification (CLAUDE.md); validation is spikes + vitest + the manual quickstart.
