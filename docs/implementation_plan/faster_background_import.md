# Faster import that runs in the background (spec 016)

Spec: `specs/016-faster-background-import/` (spec, plan, research R1–R13, data model, contracts, tasks).

## Where things are

| Concern | Files |
|---|---|
| Step timing (developer only) | core `perf/step-timing.ts`; Main `perf/timing-log.ts` (`READMATE_TIMING=1` → `{userData}/logs/timing.jsonl`); renderer `hooks/app/stepTimer.ts`; phone `native/bridge/app.ts` (`readmate.devTiming`, dev builds, logcat `[timing]`) |
| First page drawn | `hooks/reader/firstPageSignal.ts` (`beginOpening` / `markFirstPageDrawn` from the EPUB / PDF / TXT / MD renderers) |
| Ranged ZIP reader | core `zip/ranged-zip.ts` (`openRangedZip` = `ArchiveReader` over a `RandomAccessSource` + `InflateRaw`); Desktop EPUB adapter (`fs` + `zlib`), phone `native/bridge/ranged-book.ts` (local-server `Range` / `files.readChunk`, `DecompressionStream('deflate-raw')`, JSZip fallback on the entry's bytes only) |
| Hash once | `ipc/import.ipc.ts` `fingerprintAndCheck` → importer `import(path, { known })`; `file_changed` when size / mtime differ before saving |
| Signature after saving | `signature/signature-queue.ts` (`scheduleSignatureCheck`, writes only if the book and its sha256 are unchanged); non-PDF formats keep their format-only answer at import |
| Covers without the whole book | `library:getCoverSource` / `library:readBookRange` (`files/cover-source.ts`, phone `native/bridge/cover-source.ts`); `generateBookCover` (pdf.js `PDFDataRangeTransport`, EPUB leading documents via core `readEpubLeadingDocuments`); `setGeneratedCover` returns `coverUrl` → `libraryBooksStore.patchBook` |
| Library list | `hooks/library/libraryBooksStore.ts` (`load`, `upsertBook`, `patchBook`); `useLibraryBooks` reads it |
| Queue (shared) | core `app-models/import-queue.ts` (transitions, cancel rules, batch summary, placeholders, snapshot); `hooks/library/importQueueStore.ts` (runner, one job at a time) |
| Desktop host | `import:pickFiles|runJob|cancelJob|reportActivity|cancelAll` (`ipc/import.ipc.ts`, `ipc/picked-files.ts`); quit confirmation `background/quit-guard.ts`; startup sweep `files/import-sweep.ts` |
| Phone host | `files.pick { multiple }`, `files.checkPick`, native `File.copy()` + `File.digest('SHA-256')` with chunked fallback (`host/file-service.ts`, `host/expo-host-fs.ts`); saved queue `host/import-queue-file.ts` (`import-queue.json`, `import-picks.json`) |
| UI | `components/import/ImportQueueCard.tsx` (pill + card, elapsed counter, result pill, live region), `ImportQueueList`, `ImportBatchSummary`, `ImportPlaceholderTile` / `Row`, `LibraryImportPlaceholders`; CSS `styles/import-queue.css` |
| Opening gate | `hooks/reader/readerOpeningStore.ts` + Main `perf/reader-opening-gate.ts` (`app:setReaderOpening`): indexing, word count, signature queue, covers and the next import job wait for the first page (≤ 10 s) |

## Rules worth knowing

- The renderer never gets a path: pick ids, book ids, byte ranges (≤ 1 MiB) only.
- One import job at a time; "Saving" cannot be cancelled; URL / cloud progress needs no job id for that reason.
- The phone keeps only waiting / running / failed / interrupted jobs across launches; a running one comes back
  "Interrupted"; a lost pick → "Interrupted" with Try again opening the picker.
- A result pill auto-hides after 10 s only while the window is shown and focused and nothing failed; a batch shows no
  per-file toast.

## Checks

`npm run spike:import:timing [-- --label …]`, `spike:import:parity` (rows vs `fixtures/baseline-rows.json`),
`spike:import:queue` (real store, fake host), `spike:import:cleanup` (SC-006), core vitest `tests/zip`, `tests/epub`,
`tests/app-models/import-queue.test.ts`, `tests/perf`, Mobile vitest `host-services` / `import`.
Manual: quickstart §1–§4 (baseline on real samples, SC-003 / SC-004 / SC-005, 20-file pick, hidden window, phone
relaunch).
