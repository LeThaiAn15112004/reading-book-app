# Implementation Plan: Annotation Import and Export (EPUB, PDF, TXT, Markdown)

**Branch**: `006-annotation-import-export` | **Date**: 2026-10-28 | **Spec**: [spec.md](spec.md)

## Summary

Export a book's annotations to a `.readmate-notes.json` file (restorable) or a `.md` file (readable); import the JSON back
into the same book after a preview. Core logic (file schema, build, validate, plan-the-import, readable renderer) is
platform-agnostic code in `book-reader-sdk`; Main owns dialogs, SQLite reads and the one-transaction write; the renderer
has a small store + dialogs reached from the Reader More menu, the Library book menu and a Library-level action.
Same-fingerprint books are placed exactly from the stored locator; a different edition is re-anchored by quote only for
TXT only; Markdown and EPUB are placed only on identical content and PDF only for the same document (same title/author, page count known on both sides and equal); everything else is "not placed" (FR-011). The Reader menu and the Library use one identification step; a file from a different book needs a deliberate target choice (FR-010). After a successful import the open Reader reloads its annotations.
The write is ONE `BEGIN IMMEDIATE` transaction in Main over the shared SQLite connection (not `SqliteTxtStore.commit`, which cannot nest); the preview is re-validated inside it. See research.md R2, R5, R6 and the audit.

## Technical Context

**Language/Version**: TypeScript (strict), Node in Electron Main, React renderer
**Primary Dependencies**: better-sqlite3 (existing), zustand (existing); no new runtime dependency
**Storage**: existing `notes` table read/written through `sqlite-overlay-store`; one import transaction calling `SqliteOverlayStore.writeHighlight` (TXT: with an inline revision/content-hash check); no new migration (see data-model.md)
**Testing**: SDK vitest for schema / plan / readable / matching; desktop spikes `spike:annotations:main` and `spike:annotations:store` (repo convention: no desktop test runner); no E2E unless asked
**Target Platform**: Desktop (Electron, Windows first); mobile out of scope
**Project Type**: desktop-app + shared SDK
**Performance Goals**: 1,000 annotations export < 30 s end to end; 5,000 import < 60 s with the UI responsive (work in Main, progress events)
**Constraints**: book file never written; renderer never sees a path; import all-or-nothing; SDK stays free of electron / node / DOM
**Scale/Scope**: one book per file; up to ~5,000 annotations; file size a few MB

## Constitution Check

`.specify/memory/constitution.md` is still the unfilled template, so there are no project gates. The repo's own rules in
CLAUDE.md are used instead and pass: SDK dependency rule (pure logic in SDK), IPC four-place sync, renderer never gets
paths, book file read-only, Main-owned dialogs, TXT never written through `overlay:saveHighlight`. Re-checked after
design: no violations; no complexity to justify.

## Project Structure

### Documentation

```text
specs/006-annotation-import-export/
├── plan.md  research.md  data-model.md  quickstart.md  audit.md
├── contracts/ (annotation-file.schema.json, ipc.md, readable-markdown.md)
├── samples/   checklists/   spec.md
└── tasks.md   # /speckit-tasks
```

### Source Code

```text
source/apps/book-reader-sdk/src/annotation-transfer/     # new, pure
├── file-format.ts       # types, FILE_VERSION, parse/validate (reject newer version, damaged)
├── export-build.ts      # note rows + book identity -> file object (origin, place per format)
├── import-plan.ts       # file + target book + existing rows -> {toAdd, present, notPlaced[]}
├── quote-match.ts       # confident re-anchoring in plain text (TXT only)
├── readable-markdown.ts # file object -> .md text, reading order
└── index.ts             # re-exported from src/index.ts
source/apps/book-reader-sdk/tests/annotation-transfer/*.test.ts

source/apps/reading-book-desktop/electron/
├── annotation-transfer/
│   ├── export-service.ts   # read rows, build, save dialog, atomic write (writeFileSafely)
│   ├── import-service.ts   # pick/read file, identify book, preview session, confirm -> one transaction, cancel
│   └── identify-book.ts    # sha256 first, then title+author+format
└── ipc/annotation-transfer.ipc.ts   # + channels.ts group, api-types.ts Dtos, preload.ts, ipc/index.ts
source/apps/reading-book-desktop/src/
├── bridge/annotationTransfer.ts
├── screens/Reader (More menu items), screens/Library (book menu + "Import annotations file…")
├── components/annotation-transfer/  # ImportPreviewDialog, result toast
└── screens/Reader/logic/annotationTransferStore.ts   # zustand
source/apps/reading-book-desktop/spikes/annotations/  # main + store spikes
```

**Structure Decision**: SDK for pure logic, Main for I/O, renderer thin — the same split as PDF export and ZIP import.

## Complexity Tracking

None.
