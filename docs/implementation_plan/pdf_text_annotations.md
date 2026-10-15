# PDF text annotations

Date: 2026-10-15.

Highlight, Underline, Strikethrough and Note (a note anchored to selected text) on the PDF surface.
Annotations live in the app's SQLite `notes` table like EPUB highlights. The PDF file is never
modified, and nothing is embedded in or exported to the PDF.

Out of scope: OCR (a scanned PDF without a text layer has nothing to select), freehand, stamps,
drawing tools, export into the PDF, and unifying the SDK `sql-notes.ts` JSON (§9).

## 1. Decisions

1. Rects are **normalized 0–1** against the page box the reader displays.
2. Scope: text selection on the PDF.js text layer plus notes on a selection. No OCR, freehand or stamps.
3. A separate **`pdfHighlightsStore`**. The EPUB `highlightsStore` is unchanged (it is bound to
   epub.js events, handles and CFIs).
4. Reuse the SQLite `notes` table, the `overlay:*` IPC, the bridge, colors, citation, undo history
   and the annotation UI. The only changes there are additive optional fields and type widening.
5. The SDK `sql-notes.ts` JSON stays as it is. The divergence is recorded in §9.

## 2. Audit before the change (Phase 1)

The earlier audit's claims were re-checked against the code. All of them held:

- `rowToHighlightRecord` (Main) reads `locatorExtended.locator` with **no** kind check.
- The renderer mapper `highlightDtoToReaderHighlight` drops every non-`CfiLocation` row, and
  `ReaderHighlight.cfiRange` is required.
- **PDF bookmarks** already store a `PageRectLocation(page)` in `notes`, with `chapterIndex = page − 1`
  (`useReaderBookmarks.togglePdfPageBookmark`). PDF annotations follow the same convention.
- `INoteState.pdfAnnotation` existed in the type but nothing wrote or read it.
- The coordinate spaces disagreed: `PdfSelectionInfo.rects` were 0–1 fractions with a 1-based page,
  while the `PdfAnnotationRect` comment said "unscaled PDF page coordinates" with a 0-based page.
- The SDK `sql-notes.ts` uses a different `note_json` layout from Main (§9).

| Function (PDF) | Before | After |
|---|---|---|
| Text selection on the text layer, selection menu | implemented (Copy, Citation, Translate, Bookmark here) | implemented, unchanged |
| Highlight / Underline / Strikethrough from the selection menu | missing (items hidden) | implemented |
| Toolbar markup tools (drag over text marks it) | missing (`markupAnnotations` not on PDF) | implemented |
| Note on a selection | missing | implemented (📝 icon + note popup) |
| Persistence of PDF geometry | missing (`pdfAnnotation` never written) | implemented (`note_json.pdfAnnotation`) |
| Mark painting | missing | implemented (per-page overlay) |
| Click / right-click on a mark → menu | missing | implemented (renderer hit-test) |
| Edit color / style / note / tags, delete | missing for PDF (UI typed to EPUB rows) | implemented (shared popups) |
| Undo / redo / Delete key | EPUB only | implemented (generic history) |
| Sidebar Notes list for PDF | broken in practice (always empty: rows dropped) | implemented (grouped by page) |
| Restore on reopen | missing | implemented, verified across an app restart (E2E) |
| SDK / mobile reading desktop PDF rows | unverified | still unverified (§9) |

## 3. Data contract

One `notes` row per annotation. `group` = `'annotation'` and `type` ∈ `highlight | underline |
strikethrough | textbox` (textbox = Note). The `note_json` of a two-line selection on page 3 that
continues on page 4:

```json
{
  "schemaVersion": 1,
  "type": "highlight",
  "group": "annotation",
  "locatorExtended": {
    "locator": { "kind": "page-rect", "page": 3, "rect": { "x": 0.1, "y": 0.8, "width": 0.7, "height": 0.05 }, "chapterIndex": 2 },
    "text": { "highlight": "selected text" }
  },
  "pdfAnnotation": {
    "pageIndex": 2,
    "rects": [
      { "pageIndex": 2, "x": 0.1, "y": 0.8,  "width": 0.7, "height": 0.02 },
      { "pageIndex": 2, "x": 0.1, "y": 0.83, "width": 0.4, "height": 0.02 },
      { "pageIndex": 3, "x": 0.1, "y": 0.05, "width": 0.3, "height": 0.02 }
    ]
  },
  "textualValue": "selected text",
  "note": null,
  "style": { "colorHex": "#FFEB3B" },
  "created": "…", "modified": "…"
}
```

- **Jump target:** `locatorExtended.locator` is a `page-rect` on the first page.
  - `rect` is the bounding box of the rects on that page.
  - `chapterIndex` is the 0-based page, exactly like PDF bookmarks.
  - Navigation and the sidebar use it.
- **Geometry:** `pdfAnnotation` holds every glyph-run rect of the selection, across lines and pages.
- **Coordinates:** normalized 0–1 against the displayed page box: the PDF.js viewport at scale 1,
  meaning the crop box with the page `/Rotate` applied, top-left origin, y pointing down. They are
  zoom-independent and are drawn back as percentages of the page slot. They are rounded to 5
  decimals and clamped to the page on creation.
- **Page numbering:** the renderer, locators and UI use 1-based `page`. Only `PdfAnnotation` uses
  0-based `pageIndex` (the annotation's first page, plus each rect's own page).
  `book-reader-sdk/src/app-models/pdf-highlight.ts` is the **only** place that converts between them
  (`pdfAnnotationFromRects` / `pdfRectsFromAnnotation`).
- **EPUB rows** are unchanged: no `pdfAnnotation` key, so they are byte-identical on re-save.
- **IPC:** `HighlightDto.pdfAnnotationRef?` and `SaveHighlightInput.pdfAnnotationRef?` carry the JSON
  `PdfAnnotation`. The domain `HighlightRecord.pdfAnnotation?` and port `SaveHighlightInput.pdfAnnotation?`
  are new optional fields; nothing existing changed type.

### Validation

`overlay:saveHighlight` in Main runs `parsePdfAnnotationRef` and `isConsistentPdfHighlight`.

- **Size:** the payload is at most 512 KiB before parsing.
- **Pages:** `pageIndex` must be an integer from 0 to 99 999. A rect's `pageIndex` must be at least the annotation's.
- **Rects:** there must be 1–2000 of them.
- **Values:** each coordinate must be finite, `width` and `height` must be greater than 0, and the
  rect must lie inside 0–1 (with a 1e-6 tolerance).
- **`contents`**, if present, must be a string of at most 10 000 characters.
- **Locator:** it must be a `page-rect` on `pdfAnnotation.pageIndex + 1`.

Any failure refuses the whole save (the handler returns `null`) and writes nothing. On read, Main
validates `pdfAnnotation` again. A corrupt row loses its geometry, and the renderer's PDF mapper then
drops it instead of painting garbage.

## 4. How it works

- **SDK** (`app-models/pdf-highlight.ts`): rect normalization, conversion, validation, the locator
  packer, the DTO → `PdfReaderHighlight` mapper and `pdfMarkAt` (hit-test).
  - `ReaderHighlightBase` is the format-independent row that the shared UI reads.
    `ReaderHighlight` (EPUB) is `ReaderHighlightBase` plus the CFI, and `PdfReaderHighlight` is
    `ReaderHighlightBase` plus `page`, `chapterIndex` and `rects`.
  - Highlight history and undo are now generic over the row type. They default to `ReaderHighlight`,
    so the EPUB store is unaffected.
- **Main:** `buildHighlightNoteJson` writes `pdfAnnotation`, and `rowToHighlightRecord` reads and
  re-validates it. No other SQL changed.
- **Renderer:**
  - **Overlay** (`PdfAnnotationLayer.tsx`). These are React children of each page slot, separate
    from the canvas and `.textLayer` that PDF.js owns.
    - Marks exist whether or not the page is rendered. Virtualization only drops the canvas and text
      layer, and marks survive the background page-size refresh.
    - Zoom, resize and scroll never move them, because they are percentages of the slot.
    - The marks layer uses `mix-blend-mode: multiply` with `z-index: 0`, under the text-layer spans
      (`z-index: 1`), so glyphs stay crisp and `::selection` stays visible.
    - Notes are drawn as a 📝 icon at the end of the text, in their own layer (EPUB parity).
    - **No layer takes pointer events**, so text under a mark can still be selected and copied.
  - **Hit-testing** (`PdfRenderer.annotationAt`) checks note icons first (their DOM box), then
    `pdfMarkAt` on the normalized point within the page slot (2 px slop).
    - A plain click on a mark opens that annotation's menu.
    - A right-click outside a live selection does the same.
    - A click on blank page area dismisses the annotation UI.
  - **Markup tools:** Highlight, Underline or Strikethrough sets `data-pdf-markup`, which gives the
    pen cursor. A press that ends with text selected (a drag, or a double or triple click) calls
    `onMarkupSelection` with `readPdfSelection(root)`, and that selection becomes a mark.
  - **Selection stays painted (Hand):** Hand allows text selection only while the pointer rests on
    text (`data-pdf-hover-text`). Once the pointer left the text, for example into the selection
    menu, `user-select` went back to `none`. Chromium then neither paints nor `toString()`s the
    selection, so it looked lost even though the menu still had it. PdfRenderer now sets
    `data-pdf-has-selection` from `selectionchange` while a non-collapsed selection lives in the
    PDF, and CSS keeps the text layer selectable for as long as that holds. The cursor stays Hand's,
    and a pan press still disables selection (`data-pdf-grabbing`).
  - **Stable drag-selection** (`pdfTextLayerSelection.ts`, a port of pdf.js viewer's
    `TextLayerBuilder` logic, which the bare `TextLayer` lacks):
    - The bug: dragging through the gaps between glyph runs (past a line end, between lines or
      paragraphs) put the pointer on the `.textLayer` div itself, and Chromium snapped the selection
      to the end of the layer, so everything below the pointer got selected.
    - The fix: each text layer gets an `.endOfContent` div. It covers the layer while selecting
      (`.textLayer.selecting`, pdf_viewer.css), and on every `selectionchange` it is moved right
      after the selection's moving end.
    - It is attached and detached as pages render, re-render and are released.
  - **API:** `goToPagePoint(page, y)` scrolls the annotation's line to the upper third of the view.
    `flashAnnotation(id)` pulses the marks after a sidebar jump.
- **Store** (`logic/pdfHighlights/pdfHighlightsStore.ts`, adapter hook `useReaderPdfHighlights`):
  - It owns the row list, the open menu (`activeHighlight`), the focus outline, the session color,
    and undo/redo.
  - Edits are optimistic and roll back on failed create or delete, like the EPUB store.
  - The menu closes on zoom changes.
  - It loads only for a PDF surface, and it resets on book change.
- **ReaderScreen:**
  - `markup = isPdfSurface ? pdfHighlights : highlights` feeds the shared popups
    (`HighlightEditPopup`, `NoteFloatingMenu`, `NoteTextboxPopup`), the sidebar actions and the
    Ctrl+Z / Ctrl+Y / Delete shortcuts.
  - The PDF selection menu now gets the four markup callbacks. Copy, Copy with Citation, Translate
    and Bookmark here are unchanged.
- **Capabilities:** `markupAnnotations` is enabled for `pdf`, which makes the toolbar Annotation menu
  appear.
- **Sidebar:** PDF rows group by `chapterIndex` (the 0-based page). The label comes from the existing
  PDF `sectionLabels` ("Page N"), and the header reads "Page N of M" (`sectionNoun`). The PDF outline
  is not used as group metadata; that was optional.

## 5. Files

SDK (`source/apps/book-reader-sdk`):
- `src/app-models/pdf-highlight.ts` (new), `src/app-models/index.ts` — the PDF contract.
- `src/app-models/highlight-location.ts` — `ReaderHighlightBase`. `ReaderHighlight` has the same shape as before.
- `src/app-models/highlight-history.ts`, `highlight-undo.ts` — generic over the row type, with defaults unchanged.
- `src/domain/annotation/note.ts` — `PdfAnnotation` / `PdfAnnotationRect` docs (normalized coordinates) and an optional `PdfAnnotationRect.pageIndex`.
- `src/domain/annotation/highlight.ts`, `src/domain-ports/overlay-store.ts` — optional `pdfAnnotation`.
- `src/testing/in-memory.ts` — the reference store keeps `pdfAnnotation`.
- `tests/app-models/pdf-highlight.test.ts` (new).

Desktop (`source/apps/reading-book-desktop`):
- `electron/ipc/api-types.ts`, `electron/ipc/overlay.ipc.ts`, `electron/persistence/sqlite-overlay-store.ts`.
- `src/reader/renderers/pdf/PdfAnnotationLayer.tsx` (new), `pdfTextLayerSelection.ts` (new), `PdfRenderer.tsx`, `pdfSelection.ts` (`readPdfSelection`), `index.ts`.
- `src/reader/capabilities.ts`, `src/index.css` (`.rb-pdf-annot-*`, markup cursors).
- `src/screens/Reader/logic/pdfHighlights/pdfHighlightsStore.ts` (new), `logic/hooks/useReaderPdfHighlights.ts` (new), `logic/hooks/index.ts`, `logic/index.ts`.
- `src/screens/Reader/ReaderScreen.tsx`.
- `src/screens/Reader/components/highlights/HighlightEditPopup.tsx`, `NoteTextboxPopup.tsx`, `components/sidebar/NoteFloatingMenu.tsx`, `NoteItemMenu.tsx` — prop type widened to `ReaderHighlightBase`.
- `src/screens/Reader/components/sidebar/TocSidebar.tsx` — `SidebarHighlight` row type and `sectionNoun`.
- `src/screens/Reader/logic/pdfSelection/pdfSelectionMenuStore.ts`, `logic/hooks/pdfAnnotationTools.ts` — comments refreshed. Freehand and stamp remain placeholders.
- `spikes/pdf-annotations/*` (new) and `package.json` (`spike:pdf:annotations`); `spikes/reader-toolbar/run-toolbar.mjs` updated for the new PDF capability.
- `e2e/specs/pdf-annotations.spec.ts`, `e2e/support/build-text-pdf.mjs` (new); `e2e/fixtures/app.ts` (`launchApp`, `userData` for relaunching).

## 6. Schema / migration

None. `notes.note_json` is free-form JSON (migrations 018 and 019), and `pdfAnnotation` is one more key.

## 7. Tests run

| Check | Result |
|---|---|
| SDK `npm run verify` (typecheck, test typecheck, vitest, build) | ✅ 9 files, 96 tests, including 29 new PDF tests |
| Desktop `npm run typecheck`, `npm run lint` | ✅ |
| `npm run e2e:typecheck` | ✅ |
| `spike:pdf:annotations` (new): the real `overlay:*` IPC and `SqliteOverlayStore` on the migrated schema (node:sqlite) | ✅ 21 checks |
| `spike:reader:toolbar` (updated), `spike:pdf:search`, `spike:reader:hand`, `spike:settings:reset`, `spike:session:roundtrip`, `spike:overlay:cfi` | ✅ |
| Full Playwright E2E (`vite build` + `playwright test`) | ✅ 23 / 23, including the 4 new specs. One run hit a teardown timeout (closing the app) on a TOC spec; it passed on re-run |

**SDK unit tests** cover:
- the page conversion in both directions, with multi-line and multi-page selections;
- clamping and dropping of rects, and the rect cap;
- 15 invalid payload shapes and the size cap;
- the locator shape and consistency check;
- the DTO mapper, including that the PDF and EPUB mappers never take each other's rows;
- `pdfMarkAt` topmost and slop behavior;
- an in-memory store round trip with per-book isolation;
- generic undo/redo on PDF rows.

**The Main spike** checks:
- save and list for all four kinds;
- that 9 bad payloads are refused with no row written;
- that an update keeps `created_at` and the geometry;
- book isolation, and that a delete with the wrong book is refused;
- that the legacy EPUB row stays byte-identical;
- that the PDF bookmark is untouched and can't be overwritten by a highlight save;
- that a corrupt row is dropped on read.

## 8. E2E / runtime verified (Electron, `e2e/specs/pdf-annotations.spec.ts`)

**Spec 1** uses a 14-page text PDF:
- Highlight two lines from the selection menu. Each mark lands within 1.5 px of its line's glyph box.
- The selection is consumed, and the text under the mark can still be selected.
- Strikethrough from the menu.
- Underline from the toolbar tool with a real mouse drag.
- Note from the menu: the popup opens, the text is saved and the 📝 icon appears.
- A click on a mark opens the edit popup with the focus outline.
- Zoom in twice: the marks stay on the glyphs.
- Go to page 14: page 1's canvas is released but its marks remain. Come back: the marks are aligned again.
- The sidebar Notes group "Page 1" lists the entries, and clicking one jumps from page 10 to page 1.
- **The whole app is closed and relaunched on the same userData.** Every mark comes back aligned,
  the note text comes back, and delete followed by Ctrl+Z works in the new session.

**Spec 3 (Hand, regression):**
- Drag-select two lines in Hand mode, then right-click.
- Move into the menu, then press, drag and release inside it.
- Expected: the selection is still there and the text is still `user-select: text`. Before the fix
  it was `none` and the selection was empty.
- Highlight from the menu still works, and Hand's text goes back to `none` once the selection is consumed.

**Spec 4 (Select, regression):**
- Start at the beginning of line 2, drag past its end, then into the gap between lines 3 and 4.
- Expected: the selection never contains lines 5–8. The pre-fix build failed this (it selected to
  the end of the page); with the fix it passes.

**Spec 2:**
- A PDF highlight is created, then the EPUB sample is opened.
- A selection, right-click and Highlight still creates a CFI highlight, which epub.js paints.
- The EPUB's Notes list shows only its own entry: no PDF page group, no PDF text.

The existing 19 E2E specs (TOC sync, Page layout, Fit page, cursor zoom, EPUB TOC) still pass.

## 9. Limitations / follow-ups

- **Coordinates are in display space.** They are relative to the rotated, cropped page as PDF.js
  shows it. That is consistent for painting, because the same viewport always renders the page.
  Exporting into the PDF file would need the inverse viewport transform into PDF user space, and
  that is not implemented.
- **Rect granularity:** rects are the client boxes of the selected glyph runs (text-layer spans), so
  a mark's box follows PDF.js's span metrics. These are close to the glyphs but not the exact ink.
- **No text layer, no annotations:** scanned or image-only PDFs can't be annotated, because there is no OCR.
- **One row per annotation:** a selection across pages is a single annotation, anchored and grouped
  under its first page.
- **Menu position:** the annotation menu is fixed at the click point. It closes on zoom but not on
  scroll, so a note draft isn't lost while scrolling.
- **Translate mode** is still not offered on PDF (unchanged). Translate from the selection menu works.
- **No outline metadata** on sidebar groups. Groups are labelled "Page N" only.
- **SDK `sql-notes.ts` vs desktop JSON — not unified.** Compatibility with the SDK, and therefore
  mobile, is **not** claimed.

  | | Desktop `sqlite-overlay-store.ts` | SDK `persistence/sql-notes.ts` |
  |---|---|---|
  | Jump target | `locatorExtended.locator` | top-level `locator` |
  | Style kind | `type` | `styleKind` |
  | Color | `style.colorHex` | top-level `colorHex` |
  | Selected text | `locatorExtended.text` (+ `textualValue`) | top-level `selectionText` |
  | Group filter | `group` = `'annotation'` **or absent** | `group` = `'annotation'` only |
  | PDF geometry | `pdfAnnotation` (this change) | not read, not written |

  As a result, `sql-notes.ts` cannot decode any desktop highlight row (EPUB or PDF), and the
  desktop cannot decode rows written by `sql-notes.ts`. Making the shared SQL schema truly shared
  is a separate task. The in-memory reference store (`testing/in-memory.ts`) does carry `pdfAnnotation`.
