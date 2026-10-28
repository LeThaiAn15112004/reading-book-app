# Implementation Plan: Typewriter Note for PDF

**Branch**: `005-typewriter-note` | **Date**: 2026-10-27 (revised) | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-typewriter-note/spec.md`

## Summary

A rich-text text box on a PDF page: created by click or drag, edited in place (including from Hand Mode), formatted per range or per box, configured from the reader's right sidebar, and saved into the PDF as a `/FreeText` annotation whose appearance carries the text in an **embedded Unicode font**, so Vietnamese is real text everywhere. It is a sibling of the Shape tools: a new `HighlightStyleKind` stored as an ordinary `notes` row, so the Notes list, `pdfHighlightsStore` undo/redo, `overlay:*` IPC and the always-on two-way sync are reused. Three parts are new and have no precedent in the repo: the rich-text document model, a shared layout engine, and font embedding in the incremental writer. The design is in [research.md](research.md), [data-model.md](data-model.md), [contracts/typewriter-note.md](contracts/typewriter-note.md).

## Technical Context

**Language/Version**: TypeScript (strict); SDK is platform-agnostic ES2022 (`types: []`); desktop is Electron + Vite + React

**Primary Dependencies**: existing: `pdfjs-dist` 5.4.624 (render + read-back), `zustand`, `react-colorful` (colour picker), `better-sqlite3`. **New, to be decided in M0**: a TrueType parser/subsetter (small in-repo module preferred; a library only with user approval) and bundled font files (OFL/Apache) with licence notices. No new IPC library, no PDF library

**Storage**: existing `notes` table (`note_json`); PDF file by incremental update; defaults in renderer `localStorage`. **No migration**

**Testing**: SDK vitest for all pure logic (document model, run mapping, formatting, layout, coverage check, export plan, merge); desktop spikes for Main + stores; manual cross-reader kit; E2E is manual-only (not run by agents)

**Target Platform**: Desktop (Windows, macOS, Linux)

**Project Type**: desktop-app + SDK library

**Performance Goals**: typing latency not perceptibly slower than a textarea (re-layout of ≤ 10 000 characters under 16 ms on a mid laptop is the target to measure in M0); writing one note into a PDF under 1 s on a 100-page file

**Constraints**: book file mutated only by the existing eligible incremental update; renderer never sees paths; SDK has no Electron/DOM imports; Main re-validates every payload; no silent text loss anywhere

**Scale/Scope**: one style kind, one editor, one overlay integration, one sidebar panel, one prefs store, one writer branch with font embedding, one scan/merge branch; 10 000 characters, 500 runs per note

## Constitution Check

`.specify/memory/constitution.md` is still the unfilled template, so there are no project gates. The binding rules are the repo invariants in `CLAUDE.md`:

| Rule | Status |
|---|---|
| SDK imports no Electron/DOM/format engine | Pass: document, layout, merge and export plan are pure; font bytes and metrics come in through a port |
| Renderer never touches SQL/fs/paths | Pass: only `overlay:*` through `window.api`; fonts are bundled assets |
| Book file never mutated except the eligible incremental PDF update | Pass: same writer, same eligibility checks, read-back |
| IPC kept in sync in four places | Pass: **no new channel**; `HighlightDto` gains an optional field (contracts §1) |
| Main re-validates payloads | Pass: `parseTypewriterDoc` in `parsePdfAnnotation` |
| Unit tests only in SDK | Pass |
| Reuse over duplication (one right sidebar, one selection pipeline) | Pass: extends `ReaderRightSidebar`, `useRightPanelStore`, the Ink/shape overlay |

New third-party surface (fonts, possibly one parser package) is called out as a gate item, not hidden. Post-design re-check: pass.

## Project Structure

### Documentation (this feature)

```text
specs/005-typewriter-note/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/typewriter-note.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks, not created here
```

### Source Code (touch points)

```text
source/apps/book-reader-sdk/src/
├── typewriter/                          # NEW module (pure)
│   ├── typewriter-doc.ts                # types, parse/normalise/validate, NFC, limits
│   ├── typewriter-edit.ts               # run mapping on text edits, apply style to range/whole/caret
│   ├── typewriter-layout.ts             # wrap, justify, line boxes, overflow; FontMetrics port
│   ├── typewriter-fonts.ts              # font family ids, face lookup, coverage check, fallback rule
│   └── index.ts
├── app-models/
│   ├── highlight-location.ts            # + 'typewriter' in HighlightStyleKind
│   ├── pdf-highlight.ts                 # parsePdfAnnotation accepts `typewriter`
│   ├── pdf-annotation-export.ts         # + 'FreeText' write subtype, typewriter mapping, plan fields
│   ├── pdf-annotation-two-way.ts        # typewriter sync fields (kind, color, text, geometry)
│   └── pdf-embedded-annotations.ts      # FreeText identity for owned annotations
├── domain/annotation/{highlight,note}.ts  # + style kind, PdfTypewriterGeometry type
└── index.ts                             # exports
source/apps/book-reader-sdk/tests/typewriter/*.test.ts   # NEW; extend tests/app-models/pdf-annotation-*.test.ts

source/apps/reading-book-desktop/
├── assets/fonts/typewriter/             # NEW: shipped faces + OFL/Apache licence texts   (M0 picks the files)
├── electron/
│   ├── ipc/overlay.ipc.ts               # allow 'typewriter'; validate doc
│   ├── ipc/api-types.ts                 # HighlightDto.pdfAnnotation.typewriter?
│   ├── persistence/sqlite-overlay-store.ts   # include 'typewriter' in the type lists
│   ├── pdf-sync/pdf-font-embed.ts       # NEW: TrueType read + subset + Type0/CID objects + ToUnicode
│   ├── pdf-sync/pdf-incremental-writer.ts    # FreeText branch (dict + AP with fonts, underline/strike)
│   └── pdf-sync/pdf-annotation-scan*.ts / pdf-graphics.ts  # owned FreeText = managed row; verification read-back
├── src/reader/renderers/pdf/
│   ├── PdfTypewriterLayer.tsx           # NEW: paints notes from the layout engine
│   ├── PdfTypewriterEditor.tsx          # NEW: in-place editor (model-authoritative contenteditable)
│   ├── PdfRenderer.tsx                  # create by click/drag, selection/move/resize/edit wiring, right-click on a note
│   └── PdfInkSelectionOverlay.tsx       # reused for outline/handles (typewriter target kind)
├── src/reader/capabilities.ts           # + `typewriterAnnotations` (PDF)
├── src/screens/Reader/
│   ├── components/chrome/toolRegistry.ts, ToolsMenu.tsx, ToolIcon…   # Typewriter tool + onContextMenu
│   ├── components/rightPanel/TypewriterPropertiesPanel.tsx          # NEW
│   ├── components/chrome/TypewriterQuickToolbar.tsx                 # NEW (Properties, Delete)
│   ├── components/sidebar/TocSidebar.tsx                            # Notes row + filter label
│   ├── logic/rightPanel/rightPanelStore.ts                          # + 'typewriter'
│   ├── logic/pdfTypewriter/{pdfTypewriterPrefsStore,typewriterPanelStore,typewriterEditorStore}.ts  # NEW
│   ├── logic/pdfHighlights/pdfHighlightsStore.ts                    # create/patch/move/resize/format via existing history
│   └── logic/resetAppSettings.ts                                    # register prefs reset
├── spikes/pdf-annotations/run-pdf-typewriter-font.mjs   # NEW (M0)
├── spikes/pdf-annotations/run-pdf-typewriter.mjs        # NEW (Main side)
├── spikes/pdf-annotations/run-pdf-typewriter-store.mjs  # NEW (renderer stores)
└── spikes/pdf-annotations/build-compat-kit.mjs          # extended
```

**Structure Decision**: no new package or layer. New pure logic goes in a new SDK folder `typewriter/`; infrastructure stays in `electron/pdf-sync/`; UI stays in the PDF renderer folder and the Reader screen's chrome/rightPanel/logic folders.

## Delivery and milestones

The feature ships once, when **M2** passes. M1 alone is not released.

### M0 — Font and writing spike (gate; no shipped feature code)

**Status (2026-10-27): M0 PASSED** — all of M0-1…M0-8 hold (results in `research.md`, "M0 result"). Only other-reader compatibility (T063) is still untested.

Goal: remove the two unproven technical bets before building UI on them.

Scope: a standalone script (`spike:pdf:typewriter-font`) that (a) loads the candidate font files, (b) lays out the Vietnamese test corpus with the layout prototype, (c) writes one FreeText with embedded subset fonts through the real incremental writer onto the generated test PDF, (d) reads it back with pdf.js, (e) compares widths with a browser measurement of the same font files.

**M0 passes only if all of these hold** (otherwise the plan is revised before M1):

| # | Criterion |
|---|---|
| M0-1 | Every precomposed Vietnamese letter (every vowel and tone combination, upper and lower case, plus Đ/đ) maps to a glyph in each shipped face, or the face is dropped |
| M0-2 | The written PDF opens in pdf.js; extracted text equals the input text exactly (ToUnicode works); the page renders the glyphs (pixel check of the appearance, not blank) |
| M0-3 | The written file is a valid single incremental update: original bytes unchanged, a fresh pdf.js load and the existing scan both succeed |
| M0-4 | Bold, italic, underline, strikethrough, colour, centre, right and justified lines are present in the appearance stream and read back |
| M0-5 | Line breaks from the layout engine equal the browser's rendering of the same text, font and width for the test corpus; per-line width differs by ≤ 1 px at 100 % zoom |
| M0-6 | Each shipped font's licence permits embedding (`OS/2.fsType`) and redistribution; licence texts are collected |
| M0-7 | Re-layout of 10 000 characters is under 16 ms (measured, recorded) and the file growth per written note with a subset is recorded (target: ≤ 150 KB for a Vietnamese note; larger is allowed only if recorded and accepted) |
| M0-8 | The chosen parser/subsetter works in the Electron Main bundle (`npx vite build`), or the in-repo implementation is chosen |

M0 also records which other PDF readers are installed to run the manual check (none are assumed). Result of M0 is written back into `research.md` (D3–D5) before M1 starts.

### M1 — Editing core (internal; not released alone)

Includes: SDK document/edit/layout modules and tests; `typewriter` style kind through IPC, SQLite lists, `parsePdfAnnotation`; prefs store; editor, layer, create by click/drag; selection/move/resize/edit in Hand Mode and while the tool is active; format controls; sidebar defaults and note modes; right-click on tool and note; quick toolbar; Notes list entry; undo/redo; persistence across restart; notes that cannot yet be written are shown "not in the file" (the real reasons come from M2).

Acceptance: spec User Stories 1–4 and the app-side half of 5; SC-001, SC-002, SC-005, SC-006, SC-007, SC-008. Regression checklist in quickstart passes.

### M2 — File, sync, export (release gate)

Includes: `pdf-font-embed.ts`, FreeText writer branch, read-back verification, scan ownership, three-way sync fields, conflict case for a foreign text change, export, "not in the file" reasons (ineligible file, unsupported characters, font problem) with actionable messages, extended compat kit, recorded reader results.

Acceptance: spec User Story 5; SC-003, SC-004, SC-009. If a tested reader shows a defect, the result is recorded and the feature is either fixed or released with that reader listed as not supported — never claimed.

## Dependencies

| Dependency | Needed for | Status |
|---|---|---|
| Font files + licence texts | display and embedding | not in repo; chosen in M0 |
| TrueType parse/subset capability | M2 writing, metrics for layout | not in repo; in-repo module or one package, decided in M0 |
| `react-colorful` | colour picker | present |
| Right sidebar frame | sidebar | present, extended |
| Ink/shape selection overlay | hover, select, handles | present, extended |
| Incremental writer + eligibility + read-back | file writing | present, extended |
| Compat kit | cross-reader evidence | present, extended |

## Open items and assumptions (status after implementation)

1. Font list and licences: **done** — Noto Sans (4 faces), Noto Serif (4), Noto Sans Mono (2), all SIL OFL 1.1 (`assets/fonts/typewriter/`).
2. Parser/subsetter: **decided** — in-repo `pdf-font-embed.ts`, no package installed.
3. External readers: **none tested yet** — the compatibility kit exists (`spike:pdf:compat-kit`); results are to be recorded by the user (T063). Compatibility is not claimed.
4. Select mode: **decided** — one click selects in Select Mode and with the Typewriter tool; double-click selects in Hand Mode; editing a selected note: double-click, Enter or F2.
5. Sidebar text editing: implemented as an "Edit text" action that starts on-page editing, not a second editor.
6. Not measured: pixel agreement between the app and the written file (SC-009), a real Vietnamese IME, PDFium rendering of Typewriter notes. See `docs/implementation_plan/pdf_typewriter.md`.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Shared layout engine in the SDK | file and app must wrap identically (SC-009) | browser-measured lines trusted from the renderer cannot be validated or unit-tested |
| Font embedding code | Vietnamese must be real text in the file | standard fonts cannot draw it; outlines lose text semantics |
| Model-authoritative contenteditable | mixed styles + Vietnamese IME | textarea cannot show mixed styles; canvas editor must re-implement IME |
