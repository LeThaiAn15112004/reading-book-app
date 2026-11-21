# Implementation Plan: Faster import that runs in the background

**Branch**: `016-faster-background-import` | **Date**: 2026-11-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/016-faster-background-import/spec.md`

## Summary

Four increments, in this order (story 1 gives the baseline the others are measured against):

1. **Measure** (US1) — a developer-only step timer (core `perf/step-timing.ts`), on with `READMATE_TIMING=1`
   (Desktop) / `readmate.devTiming` (phone dev builds); JSON lines with format, size and duration only. Baseline
   written to `timing-baseline.md`; SC-002 / SC-009 targets fixed after it (clarification 2026-11-21).
2. **Less repeated work** (US2) — Desktop: hash once and pass it to the importer, PDF signature check moved to a
   background queue after saving, EPUB details through a new pure **ranged ZIP reader** in core (implements the
   existing `ArchiveReader` port). Phone: **native `File.copy()` + `file.digest('SHA-256')`** (Expo SDK 58), EPUB
   details read by ranges from the local server — no step holds or ships the whole file (FR-003, FR-004a). Covers:
   text from `library:getCoverSource`, PDF page 1 through pdf.js with a range transport (`library:readBookRange`);
   the saved cover patches one Library entry (`libraryBooksStore`).
3. **Background import** (US3) — a shared queue (core `app-models/import-queue.ts` + `importQueueStore`), multi-file
   pick (≤ 50, paths kept in Main / the host), `ImportQueueCard` instead of the blocking dialog, placeholders in the
   Library, 5-group batch summary, ZIP jobs in the same queue, Desktop quit guard + startup sweep, phone queue
   snapshot with "Interrupted" after a relaunch.
4. **Opening without competition** (US4) — `readerOpeningStore` + `app:setReaderOpening`: chunking, signature queue,
   covers and the import runner wait until the first page is drawn (≤ 10 s).

No migration. New channels: `import:pickFiles|runJob|cancelJob|reportActivity|cancelAll`,
`library:getCoverSource|readBookRange`, `app:setReaderOpening|getTimingEnabled|recordTiming`; phone host
`files.readRange|checkPick`, `importQueue.load|save`.

## Technical Context

**Language/Version**: TypeScript 5 (strict); React 19 shared UI; Electron Main (Node); Expo SDK 58 host (installed
`expo-file-system@58.0.13`, `expo-document-picker` with `multiple`).

**Primary Dependencies**: existing only — zustand, `pdfjs-dist` (`PDFDataRangeTransport`), Node `zlib` / `fs`
(Main), `DecompressionStream('deflate-raw')` (WebView), `expo-file-system` `File.copy` / `digest`. `JSZip` stays for
the reader / chunking; it leaves the import path. No new package.

**Storage**: SQLite unchanged (no migration). Phone: `import-queue.json` + `import-picks.json` in `Paths.document`.
Desktop: `{userData}/logs/timing.jsonl` (timing on only).

**Testing**: core vitest — `tests/zip/ranged-zip.test.ts` (stored / deflate / ZIP64 / limits / truncated),
`tests/app-models/import-queue.test.ts` (transitions, cancel in saving refused, summary invariant, placeholders,
snapshot), `tests/perf/step-timing.test.ts` (no identifying field, off = no-op), `tests/epub/*` on the ranged reader.
Mobile vitest — `file-service` (copy + digest + fallback + cancel), bridge import (ranges), queue snapshot.
Desktop spikes — `spike:import:parity|timing|cleanup|queue` (research R12). `npm run check`. No E2E.

**Target Platform**: Desktop (Electron, Windows first) and Android (WebView host); same UI.

**Project Type**: Desktop app + mobile WebView host sharing one React UI.

**Performance Goals**: SC-002 ≥ 40 % (Desktop), SC-009 ≥ 30 % (phone) faster import of large samples; usable < 1 s
after picking (SC-003); progress every ≤ 2 s and input answered ≤ 200 ms during a several-hundred-MB import
(SC-004); first page ≤ 20 % later with an import running, ≤ 5 % right after import (SC-005).

**Constraints**: R1–R12 (ranged ZIP reader and queue are pure core; inflate / file access injected); IPC four places +
phone bridge typed by `Window['api']`; every Main change approved in `desktop-main-changes.json`; renderer never gets
a path; read-only invariant (a referenced file is only read; cleanup only inside the sandbox / staging); i18n
catalogue only, Vietnamese per glossary; theme tokens; zustand for hook state (project preference).

**Scale/Scope**: ~4 core modules (+ tests), ~6 new / ~8 edited UI files, 2 new zustand stores + 1 moved
(`libraryBooksStore`), ~10 Main files, ~5 phone files, 4 spikes, ~30 i18n keys × 2.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template; the gates are the project rules from `CLAUDE.md`.

| Gate | Status |
|---|---|
| core platform-agnostic (R1–R3): `ranged-zip`, `import-queue`, `step-timing` take injected sources / inflate, no Node / DOM globals | ✅ |
| R7 / R8 / R12: Desktop and phone code stay in their folders; UI imports `@app/platforms/*` without suffix | ✅ |
| R9: `window.api` only in `api.electron.ts`; renderer uses `bridge/import.ts` / `bridge/library.ts` | ✅ |
| IPC four places in sync + phone bridge | ✅ planned — [contracts/import-ipc.md](./contracts/import-ipc.md) |
| Main-file changes approved (`check:desktop-baseline`) | ✅ planned — one line per file (import.ipc, picked-files, file-hash, filename-fallback-importer, epub.adapter, signature-queue, library.ipc, open-book-content, background/quit-guard, main.ts, channels, preload, api-types, app.ipc, startup sweep) |
| Renderer never gets paths; DTOs plain | ✅ pick ids, book ids, byte ranges only |
| Read-only invariant: user files never written / moved / deleted; sweep only inside sandbox + staging | ✅ (`removeManagedBookDir` rule reused) |
| Signature semantics unchanged (status values, cache by SHA-256) | ✅ only the moment moves |
| Zustand for hook state; Mobile-only store needs a reason | ✅ `importQueueStore`, `readerOpeningStore`, `libraryBooksStore` are shared; no Mobile-only store |
| No literal UI text; vi glossary; Main texts via `tMain` | ✅ planned — `import.ts` `queue.*` |
| E2E not run as routine | ✅ quickstart is manual + spikes |

Post-design re-check: unchanged, all pass. Complexity Tracking: none.

## Project Structure

### Documentation (this feature)

```text
specs/016-faster-background-import/
├── plan.md              # This file
├── research.md          # Phase 0: R1–R13
├── data-model.md        # Phase 1: job / queue / placeholder / snapshot / timing
├── quickstart.md        # Phase 1: validation pass
├── contracts/
│   ├── import-ipc.md    # channels, both hosts
│   ├── phone-host.md    # host services
│   └── import-ui.md     # card, list, summary, placeholders, i18n
├── timing-baseline.md   # written by story 1
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
source/core/src/
├── perf/step-timing.ts                  # NEW (US1)
├── zip/ranged-zip.ts                    # NEW: ArchiveReader over RandomAccessSource + InflateRaw (US2)
├── app-models/import-queue.ts           # NEW: jobs, transitions, summary, placeholders, snapshot (US3)
├── domain-ports/document-importer.ts    # EDIT: import(filePath, { known? })
└── i18n/catalogue/{en,vi}/{import,main-messages}.ts   # EDIT

source/app/
├── hooks/library/importQueueStore.ts    # NEW: queue + runner (both hosts)
├── hooks/library/libraryBooksStore.ts   # NEW: replaces useLibraryBooks local state (upsert / patch)
├── hooks/library/useLibraryImport.ts    # EDIT: enqueue instead of blocking
├── hooks/library/zipImportStore.ts      # EDIT: confirm → enqueue a zip job
├── hooks/reader/readerOpeningStore.ts   # NEW (US4)
├── hooks/reader/firstPageSignal.ts      # NEW: markFirstPageDrawn(bookId) — US1 timing, US4 gate
├── hooks/app/stepTimer.ts               # NEW: renderer step timer (US1)
├── components/import/ImportQueueCard.tsx, ImportQueueList.tsx, ImportBatchSummary.tsx,
│   ImportPlaceholderTile.tsx, ImportPlaceholderRow.tsx   # NEW
├── components/import/ImportProgressDialog.tsx            # REMOVED
├── screens/Library/logic/generateBookCover.ts            # EDIT: cover source + range transport, patch one book
├── screens/Library/components/… LibraryHub / phone/MobileLibraryHub   # EDIT: placeholders first in All books
├── screens/Reader/logic/hooks/useBookIndexing.ts         # EDIT: wait for first page
├── bridge/{import,library,app}.ts                        # EDIT
├── App.tsx                                               # EDIT: mount the card / pill
└── platforms/
    ├── electron/ipc/{import,library,app}.ipc.ts, channels.ts, api-types.ts, preload.ts   # EDIT
    ├── electron/ipc/picked-files.ts                      # NEW
    ├── electron/files/file-hash.ts                       # EDIT: signal + progress
    ├── electron/files/import-sweep.ts                    # NEW: startup sweep
    ├── electron/adapters/{epub.adapter,filename-fallback-importer}.ts   # EDIT
    ├── electron/signature/signature-queue.ts             # NEW
    ├── electron/background/quit-guard.ts                 # NEW; main.ts EDIT
    ├── electron/perf/timing-log.ts                       # NEW
    ├── electron/perf/reader-opening-gate.ts              # NEW: Main mirror of the opening gate (US4)
    ├── electron/spikes/import-{parity,timing,cleanup,queue}.ts   # NEW
    ├── native/host/{file-service,expo-host-fs,import-queue-file}.ts   # EDIT / NEW
    └── native/bridge/{import,library,import-queue}.ts    # EDIT / NEW
```

**Structure Decision**: existing single project; logic that both hosts share is pure core (reader, queue, timing),
host differences are only file access, the picker and the quit guard.

## Order and risks

1. US1 first; `timing-baseline.md` decides whether SC-002 / SC-009 stay at 40 % / 30 %.
2. US2 Desktop before phone; `spike:import:parity` must pass before the old code paths are removed.
3. US3 needs `libraryBooksStore` (R8) first, then the queue core, then hosts, then UI.
4. US4 last (small).

Risks: native `copy()` from some `content://` providers (fallback planned, R5); `DecompressionStream('deflate-raw')`
in older Android WebViews (Chromium ≥ 103 — below that the phone falls back to reading the needed entries' ranges and
inflating with the existing JSZip on those bytes only); pdf.js range transport on a non-linearized PDF still reads
the xref (fine: not the whole file).

## Complexity Tracking

None.
