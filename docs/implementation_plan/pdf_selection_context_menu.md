# PDF selection context menu

Extends the EPUB right-click-on-selection menu (`HighlightContextMenu`) to the PDF surface.

## 1. Audit (before the change)

| Capability | EPUB | PDF (before) |
|---|---|---|
| Native context menu suppressed on the reading surface | Implemented (`EpubRenderer` `onContextMenu`, iframe doc) | **Missing** — native menu could show |
| Right-click inside a live selection → custom menu | Implemented (`hasFrameTextSelection` + `isPointInTextSelection`, `toOuterPoint` for iframe/zoom transform) | **Missing** |
| Live selection tracking | `highlightsStore.pendingSelection`, fed by epub.js `selected` events (CFI-based `EpubSelectionInfo`) | None. Native selection on the PDF.js text layer works (`data-pdf-tool`, `clearSelection` API) but nothing reads it |
| Copy / Copy with Citation | Implemented (`copyHighlightText`, `formatHighlightCitation` with EPUB section label) | Missing (only Ctrl+C) |
| Translate | Implemented (`translationStore.openForSelection(EpubSelectionInfo)` — only `text` + `lang` are used) | Missing; Translate toolbar tool is not in PDF capabilities |
| Bookmark | Implemented | **Implemented** for the current page (`useReaderBookmarks`, `PageRectLocation`) |
| Highlight / Underline / Strikethrough / Note persistence | Implemented: `notes` table via `overlayApi`, `locatorRef` = packed `CfiLocation`; `ReaderHighlight.cfiRange` is required; marks painted by epub.js `rendition.annotations` | **Missing**: no PDF anchor in `ReaderHighlight`, no mark painting layer, no hit-testing. `pdfAnnotationTools.ts` is an empty placeholder |
| Right-click on an existing mark → mark menu | Implemented (`getHighlightAtPoint` → `openHighlightContextMenu`) | **Missing** (no PDF marks exist to hit) |
| Search highlights | CSS Custom Highlight API | CSS Custom Highlight API (`pdfSearchDom.ts`) — inserts nothing into the text layer, so no conflict with selection or right-click |

## 2. Contract

The menu itself was already format-neutral (`point` + `selectedText` + callbacks). The only change:
the four markup callbacks (`onHighlight`, `onUnderline`, `onStrikethrough`, `onAddNote`) are now
**optional**, and the menu hides an item when its callback is absent. EPUB passes all of them, so
it renders exactly as before.

Anchors stay format-specific:

- EPUB: unchanged (`EpubSelectionInfo.cfiRange`, `highlightsStore`).
- PDF: `PdfSelectionInfo` (`reader/renderers/pdf/pdfSelection.ts`) — `text`, `pageStart`/`pageEnd`
  (1-based), `rects` (per-page rectangles as 0–1 fractions of the page slot, so they are
  independent of zoom and scroll), `lang` (empty; translation falls back to detection).

`translationStore.openForSelection` now takes `TranslationSelection = { text; lang }`, which both
selection types satisfy.

PDF menu state lives in its own small zustand store (`logic/pdfSelection/pdfSelectionMenuStore.ts`)
rather than in `highlightsStore`, which is bound to epub.js (CFI, marks, undo history).

## 3. Behaviour

On the PDF pages (`PdfRenderer` root `onContextMenu`):

1. `preventDefault()` always — never the native menu on the pages.
2. `readPdfSelectionAt(root, x, y)`: the selection must be non-collapsed, non-blank, start and end
   inside the PDF root; the click must fall within one of the rects of the *selected text nodes*
   (±2 px). Element boxes (PDF.js `.endOfContent`, the layer div) are excluded so a click on blank
   page area next to a selection doesn't count.
3. Pages come from the `data-page-number` slot of the range's start/end containers.
4. The menu opens at the event's client coordinates. The PDF surface is in the Reader document with
   `ReaderZoomViewport mode="native"` (no iframe, no CSS transform), so no coordinate conversion is
   needed at any zoom or scroll position.
5. No selection / click outside it → nothing opens.

The menu closes on: outside pointerdown or Escape (shared `useDismissOnOutsideOrEscape`), any menu
action, scrolling the pages, zoom change, book change, leaving the PDF surface and Reader unmount
(`usePdfSelectionMenu`). The text selection itself is left alone (Ctrl+C still works afterwards).

## 4. Actions on PDF

| Action | Status |
|---|---|
| Copy | Enabled — selected text |
| Copy with Citation | Enabled — `"…" — Title, Author (p. 12)` or `(pp. 12–13)` |
| Translate | Enabled — existing popover/worker flow |
| Bookmark here | Enabled — toggles the bookmark on the selection's **first page** (`togglePdfPageBookmark`), which may differ from the page in view |
| Highlight / Underline / Strikethrough / Add note | **Hidden** — see §6 |

## 5. Files

- `src/reader/renderers/pdf/pdfSelection.ts` (new) — selection read + hit test, page label.
- `src/reader/renderers/pdf/PdfRenderer.tsx` — `onSelectionContextMenu` prop, `onContextMenu`.
- `src/reader/renderers/pdf/index.ts` — exports.
- `src/screens/Reader/logic/pdfSelection/pdfSelectionMenuStore.ts`, `logic/hooks/usePdfSelectionMenu.ts` (new).
- `src/screens/Reader/logic/hooks/useReaderBookmarks.ts` — `togglePdfPageBookmark(page)`; `toggleBookmark` now delegates to a shared `toggleBookmarkAt`.
- `src/screens/Reader/logic/translation/translationStore.ts` — `TranslationSelection` input type.
- `src/screens/Reader/components/highlights/HighlightContextMenu.tsx` — optional markup items.
- `src/screens/Reader/ReaderScreen.tsx` — wiring.
- `book-reader-sdk/src/app-models/highlight-citation.ts` — doc comment only.

No database schema change and no migration.

## 6. Not done — PDF annotations (follow-up)

Highlight/Underline/Strikethrough/Add note and the right-click-on-existing-mark menu need, for PDF:

1. **Anchor**: `ReaderHighlight.cfiRange` is required and `highlightsStore.createHighlight` packs a
   `CfiLocation`. A PDF mark needs a `PageRectLocation` locator plus the page-relative rects
   (`PdfSelectionInfo.rects` is already in that shape) — likely a `PdfAnnotation`-style locator
   payload inside the existing `locatorRef` JSON. The `notes` table stores `locatorRef` as text, so
   this probably needs **no migration**, but the SDK codecs (`highlightDtoToReaderHighlight`,
   locator parsing) must learn the PDF variant — to be confirmed before implementation.
2. **Painting**: an overlay per page slot that draws stored rects (re-created when pages are
   released/re-rendered and on zoom — rects are fractions so they scale).
3. **Hit-testing** for click/right-click on a mark → `activeHighlight` / mark menu.
4. **Store split**: undo/redo, `applyAllHighlights`, focus outline are epub.js calls today.
5. Then add `markupAnnotations` to the PDF capabilities and pass the four callbacks to the menu.

## 7. Verification

Automated (run for this change):

- Desktop `npm run typecheck` — pass
- Desktop `npm run lint` — pass (0 warnings)
- Desktop `npx vite build` — pass
- SDK `npm run typecheck`, `npm test` (35 tests) — pass

The desktop app has no DOM test runner, and the hit test depends on real layout
(`Range.getClientRects`), which jsdom does not provide — so no automated test covers the
selection logic.

**Manual Electron verification — not yet performed.** Checklist:

- [ ] Select text on a PDF (Select tool, and Hand after the I-beam dwell), right-click inside → menu at the cursor
- [ ] Right-click outside the selection / with no selection / on blank page area → no menu, no native menu
- [ ] Zoom 50%, 100%, 200% and scrolled mid-document → menu at the cursor
- [ ] Multi-line and two-page selection; citation shows `pp. a–b`
- [ ] Copy, Copy with Citation (title, author, page), Translate popover, Bookmark here (selection's page, toggles off on repeat)
- [ ] Scroll / zoom / Escape / outside click closes the menu; switching book closes it
- [ ] Image-only (scanned) PDF → no selection possible → no menu
- [ ] Search highlights still paint while a selection + menu exist
- [ ] EPUB regression: selection menu still shows all items and all actions work; mark right-click menu unchanged
