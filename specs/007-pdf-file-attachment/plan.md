# Implementation Plan: PDF File Attachment

**Branch**: `007-pdf-file-attachment` | **Date**: 2026-10-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-pdf-file-attachment/spec.md`

## Summary

A PDF-only tool that places a paperclip icon on a page and embeds a picked file (≤ 100 MB) into the PDF as a
standard FileAttachment annotation + Filespec + Flate-compressed EmbeddedFile, appended as one incremental update.
Reading, opening and saving out attachments already exist (audit §1) and are reused. New: a Main-owned
**attachment write operation** (create / move / delete) that stages the picked file, streams its content into the
update without holding it in memory, verifies the temp file with pdf.js and replaces the PDF atomically — inside the
live-sync session's exclusive slot, so it never races the always-on two-way sync. A Readmate-made attachment is an
ordinary `notes` row of a new style kind `attachment` (no migration) whose content lives only in the PDF; the file
is authoritative and there is no pending state (clarification Q1). Attachments by other readers are shown and can be
opened / saved, not edited (Q3). Design: [research.md](research.md), [data-model.md](data-model.md),
[contracts/pdf-file-attachment.md](contracts/pdf-file-attachment.md).

## Technical Context

**Language/Version**: TypeScript (strict); SDK ES2022 platform-agnostic (`types: []`); desktop Electron + Vite + React

**Primary Dependencies**: existing only — `pdfjs-dist` 5.4.624 (scan / read-back), Node `zlib` / `crypto` / `fs`
streams (built-in), `better-sqlite3`, `zustand`. **No new dependency.**

**Storage**: PDF file (incremental update) holds the content; `notes` row + `pdf_embedded_annotations` ledger hold
the app-side record (no migration); staging `{userData}/attachment-staging/`, temp copies for opening as today

**Testing**: SDK vitest (geometry, ids, limits, payload validation, planner rules, messages); desktop spikes
`spike:pdf:attachment-memory` (M0), `spike:pdf:attachment-write`, `spike:pdf:attachment-store` + existing
attachment / two-way / export / toolbar spikes; manual compatibility kit; E2E manual-only

**Target Platform**: Desktop (Windows primary; macOS / Linux same code)

**Project Type**: desktop-app + SDK library

**Performance Goals**: SC-004 — 10 MB into a 50 MB PDF ≤ 5 s; 100 MB completes or is refused cleanly; the renderer
never blocks > 1 s (all heavy work in Main async I/O + the scan worker); SC-005 over-limit refusal ≤ 1 s

**Constraints**: content never held in memory by the writer; book file replaced only via temp + fsync + verify +
rename; renderer never sees paths / bytes; Main re-validates; no pending state; one file writer at a time per book

**Scale/Scope**: 1 tool, 1 style kind, 2 new IPC channels, 1 widened id shape, 1 event field, 1 writer branch +
streaming serialiser, 1 Main operation, 1 renderer overlay + details panel; ≤ 500 attachments listed per PDF

**Unknowns**: memory ceiling for PDF + content (research R3, **M0**, fallback fixed: `too_large_for_pdf`). All other
NEEDS CLARIFICATION resolved in research.md.

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template — no project gates. Binding rules are the invariants in
`CLAUDE.md`:

| Rule | Status |
|---|---|
| SDK imports no Electron / Node / DOM / format engine | Pass — geometry, ids, limits, validation, planner rules are pure; streaming / zlib / pdf.js stay in Main + worker |
| Renderer never touches SQL / fs / paths | Pass — picker, staging, writing, extraction are Main-owned; renderer sends `bookId`, page, point, rowId |
| Book file never mutated except the eligible incremental PDF update | Pass — same append-only model, same `checkWritable`, verified before replace |
| IPC kept in sync in four places | Pass — 2 new channels in `AttachmentChannels`, listed in contracts §1–2 |
| Main re-validates every payload | Pass — contracts §1, §2, §5 |
| Prefer no new migration / channel / table | Pass for migration and table. **2 new channels justified** (Complexity Tracking) |
| Unit tests only in SDK; desktop checks are spikes | Pass |
| E2E not run by agents | Pass — quickstart §2 is manual |

Post-design re-check: pass.

## Project Structure

### Documentation (this feature)

```text
specs/007-pdf-file-attachment/
├── spec.md
├── audit.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/pdf-file-attachment.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
source/apps/book-reader-sdk/
├── src/attachments/
│   ├── attachment-policy.ts        # + rm-<uuid> ids, ATTACH_COMBINED_MAX_BYTES, checkAttachSize
│   └── pdf-attachment-annotation.ts  # NEW: PdfAttachmentInfo, icon box / clamp, failure messages
├── src/app-models/
│   ├── highlight-location.ts       # + 'attachment' (and src/domain/annotation/highlight.ts)
│   ├── pdf-highlight.ts            # parsePdfAnnotation validates attachment payload
│   ├── pdf-annotation-two-way.ts   # attachment rows: no file op, file authoritative
│   ├── pdf-embedded-annotations.ts # FileAttachment (readmate: only) as scanned subtype
│   └── pdf-annotation-export.ts    # skip 'attachment'
├── src/annotation-transfer/        # skip 'attachment' (restorable), list it in readable copy
└── tests/attachments/*.test.ts, tests/app-models/*  # new cases

source/apps/reading-book-desktop/
├── electron/pdf-sync/
│   ├── pdf-incremental-writer.ts   # planAttachmentAppend, FileAttachment replace keeps /FS
│   ├── pdf-attachment-writer.ts    # NEW: stage → stream → verify → rename
│   ├── pdf-annotation-scan.ts      # FileAttachment items + pageAttachments
│   ├── pdf-annotation-sync-service.ts  # runFileOperation, event field
│   └── pdf-annotation-export.ts    # writeFileSafelyStreaming
├── electron/attachments/           # rm-<uuid> resolution by /NM; staging sweep
├── electron/ipc/                   # channels.ts, attachments.ipc.ts, api-types.ts, overlay.ipc.ts (refuse kind)
├── electron/preload.ts
├── src/bridge/attachments.ts
├── src/reader/renderers/pdf/       # attachment icon overlay (select, hover name, drag, dbl-click, context menu)
├── src/screens/Reader/logic/attachments/  # store: create / change / details panel / pageAttachments
├── src/screens/Reader/components/  # details panel, delete confirmation, failure toasts; Notes list entries
└── spikes/attachments/             # attachment-memory, attachment-write, attachment-store
docs/implementation_plan/pdf_file_attachment.md (+ _compat.md)   # map + compatibility record
```

**Structure Decision**: extends the existing PDF annotation stack (SDK app-models + Main `pdf-sync` + renderer PDF
overlay) and the existing `attachments` feature folder; no new package or module boundary.

## Milestones

| M | Content | Exit |
|---|---|---|
| M0 | `spike:pdf:attachment-memory` with a prototype of `planAttachmentAppend` + streaming | table recorded in research R3; `ATTACH_COMBINED_MAX_BYTES` fixed |
| M1 | SDK: kind, payload, geometry, ids, limits, messages, planner / export / transfer rules + tests | SDK `npm test` green |
| M2 | Main: writer branch, attachment writer, sync slot, scan additions, IPC + bridge, refusal in overlay | `spike:pdf:attachment-write` 1–14 pass; existing two-way / export / attachments spikes pass |
| M3 | Renderer: tool (PDF only), overlay icons, details panel, context menu, delete confirmation, move + undo, Notes list, failure messages | `spike:pdf:attachment-store`, `spike:reader:toolbar` pass; typecheck / lint / vite build |
| M4 | Docs: `pdf_file_attachment.md`, CLAUDE.md paragraph, compat kit + record template | compat record exists (results or "not tested") |

## Risks

- **Scan cost on PDFs with large attachments** (pdf.js materialises content in every live-sync scan) — existing
  behaviour for any PDF with attachments; measured in M0. If above budget, a follow-up (not in this feature) would
  scan with a content-free path.
- **Writes after attaching get slower** (every later annotation write parses a bigger file) — measured in M0 and
  reported; no extra mitigation in v1.
- **Reader-specific display of FileAttachment without our appearance** — covered by writing both `/AP` and `/Name`;
  real results only from the compat record.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 2 new IPC channels (`attachments:create`, `attachments:change`) | the picker, file reading and writing must be Main-owned; move / delete must reach the file or be refused synchronously (clarification Q1) | the debounced two-way cycle via `overlay:saveHighlight` creates a pending state when the file is blocked and would push up to 100 MB through the planner |
| Exception to "app edits win" for kind `attachment` | an attachment row never has unsaved edits; the file is the only place the content lives | treating the row as authoritative would recreate or keep attachments a user removed in another reader, without their content |
