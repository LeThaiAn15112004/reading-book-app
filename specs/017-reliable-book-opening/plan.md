# Implementation Plan: Reliable, clear book opening (and import without false failures)

**Branch**: `017-reliable-book-opening` | **Date**: 2026-11-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/017-reliable-book-opening/spec.md`

## Summary

Make opening a book never hang and never fail for a valid book, show it through one waiting screen on both hosts and
for every format, and remove work done before the first page; plus remove the false failures of 016's import queue.
Approach (research R1–R11): a pure opening state machine in core (`app-models/book-opening.ts`) with step time limits,
one automatic retry and an error → actions table, held by the existing renderer `readerOpeningStore`; one
`ReaderOpeningScreen` replacing three waiting screens; bounded saved-position restore with a chapter fallback; SHA-256
only for PDF and one copy of the bytes; post-first-page work on idle and running background work paused (incl. the
phone host); Desktop picks without expiry, a content-based "file changed" check, translated phone messages.

## Technical Context

**Language/Version**: TypeScript 5.x (strict), React 19, Node (Electron Main)

**Primary Dependencies**: Electron, Vite, zustand, epub.js, pdf.js; phone: Expo SDK (expo-file-system 58) +
react-native-webview + local-server module

**Storage**: none new (SQLite unchanged, no migration; picks in memory / `import-picks.json` as in 016)

**Testing**: vitest (core `source/core/tests`, mobile `source/app/platforms/native/tests`); Desktop spikes
(`spikes/open/*.mjs` new, `spikes/import/*`); manual quickstart; E2E manual-only

**Target Platform**: Windows / macOS / Linux desktop (Electron); Android (Expo dev build); iOS not built

**Project Type**: desktop + mobile app sharing one React UI

**Performance Goals**: SC-005 (≥ 30 % faster to first page for books > 50 MB, none slower); SC-006 (page turns
≤ 300 ms in the first 10 s); Back ≤ 1 s; missing-file error ≤ 2 s

**Constraints**: renderer never gets a path; core has no Node / DOM globals; step limit 20 s of foreground time; PDF
live-sync fingerprint kept; E2E not run routinely

**Scale/Scope**: 4 reader formats + audiobook preflight, 2 hosts; ~15 files changed, ~6 new

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template: no ratified principles, so no gate can fail. The project
rules in CLAUDE.md act as gates and are respected:

| Rule | How |
|---|---|
| Core purity (R1–R3) | `book-opening.ts` is pure (clock injected), tested in vitest |
| Four-place IPC rule | `releasePicks` + changed `openBookContent` result: channels, ipc, preload/api-types, bridge; phone implements the same `Window['api']` |
| Main change approvals | approval lines in `source/scripts/desktop-main-changes.json` for every changed Main file |
| i18n | every new string in `core/src/i18n/catalogue/{en,vi}` (vi plurals `{ other }`); `no-ui-literals` passes |
| Book file never mutated | only reads; no change to annotation writing |
| E2E manual-only | spikes + vitest + quickstart |

Post-design re-check: unchanged (no new storage, no new dependency).

## Project Structure

### Documentation (this feature)

```text
specs/017-reliable-book-opening/
├── plan.md            # this file
├── research.md        # R1–R11
├── data-model.md      # Opening, OpeningError, import changes
├── quickstart.md      # validation guide
├── contracts/
│   ├── opening-ui.md  # the waiting / error screen
│   └── opening-ipc.md # openBookContent result, releasePicks, phone host app.setReaderOpening
└── tasks.md           # /speckit-tasks
```

### Source Code (repository root)

```text
source/core/src/
├── app-models/book-opening.ts          # NEW state machine, limits, retry rule, actions table (R1–R4)
├── app-models/import-queue.ts          # releasePicks hook points (R8)
└── i18n/catalogue/{en,vi}/reader-chrome.ts, import.ts, main-messages.ts   # reader.opening.*, new causes
source/core/tests/app-models/book-opening.test.ts   # NEW

source/app/
├── hooks/reader/readerOpeningStore.ts  # grows into the opening store (R1, R2, R7 gate)
├── hooks/reader/useReaderBookOpen.ts   # reports steps, retry, token, leave (R2, R3, R6)
├── components/reader/ReaderOpeningScreen.tsx   # NEW one screen (R5)
├── components/reader/renderers/epub/{EpubRenderer.tsx, openEpubjs.ts, epubjs/display.ts}  # overlay removed, bounded position, idle pagination (R4, R5, R7)
├── components/reader/renderers/pdf/PdfRenderer.tsx    # loading line removed, page clamp (R4, R5)
├── screens/Reader/ReaderScreen.tsx, phone/MobileReaderScreen.tsx, screens/AudioBook/AudioBookScreen.tsx  # use the screen
├── screens/Library/logic/generateBookCover.ts          # pause inside running work (R7)
├── hooks/library/importQueueStore.ts                   # releasePicks on cancel / dismiss / clear (R8)
├── bridge/library.ts, bridge/import.ts                 # retryable, releasePicks
└── platforms/
    ├── electron/files/open-book-content.ts             # PDF-only hash, one copy, retryable (R3, R6)
    ├── electron/ipc/{import.ipc.ts, picked-files.ts, channels.ts, api-types.ts}, preload.ts   # R8, R9
    ├── electron/chunking/*, wordcount/*                 # yieldWhileOpening inside loops (R7)
    ├── storage.native.ts                                # retryable fetch failure (R3)
    └── native/{bridge/app.ts, bridge/import.ts, bridge/library.ts, host/file-service.ts, host/host-runtime.ts}  # host gate, translated messages, releasePicks (R7, R8, R10)
source/app/platforms/native/tests/      # opening retry, host gate, translated messages
source/app/platforms/electron/spikes/open/   # NEW spike:open:limits, spike:open:content
```

**Structure Decision**: the existing single project (`source/core` + `source/app` with `platforms/electron` and
`platforms/native`); no new package.

## Complexity Tracking

None: no constitution violations to justify.
