# PDF continuous scrolling + shared Reader navigation

Follows `pdf_library_setup.md` (pdfjs-dist 5.4.624, pinned). Replaces the one-page-at-a-time proof
with a continuous vertical document and plugs PDF into the navigation the EPUB renderer already uses.
No separate PDF toolbar: the Reader footer, shortcuts and TOC sidebar drive both formats.

## Root issues found

- `PdfRenderer` had its own Prev/Next buttons and page state; the shared footer showed `FAKE_CHAPTERS`
  numbers for PDF and its Prev/Next moved a placeholder chapter index.
- `PdfRenderer` sat inside `ReaderZoomViewport` with its own `overflow-auto` — a nested scroller under
  a CSS-transform zoom (blurry canvas when zoomed, two scroll owners).
- Session persistence (`useReadingSessionAutosave`, `useReaderBookOpen`) was typed to `CfiLocation`
  only, so a PDF position could not be saved or restored, though the stored value is just
  `Location.toString()` and `PageRectLocation` already exists in the SDK.
- The TOC sidebar fell back to `FAKE_CHAPTERS` for any non-EPUB book.

## Continuous scrolling design

- **One scroll owner:** `ReaderZoomViewport` gained `mode="native"`. In that mode it renders no
  scaler/transform; its child lays out at the current zoom and the viewport element is the only
  scroll container (both axes). EPUB and the placeholder keep `mode="transform"` (unchanged).
- **Zoom:** `PdfRenderer` receives `zoom` and sizes every page slot at `pageSize × 96/72 × zoom`
  (100% = real page size). Gaps/padding scale too, so the viewport's existing focal-zoom scroll
  math (`scrollAfterFocalZoom`) keeps the point under the cursor fixed. Ctrl+wheel focal zoom is
  enabled for PDF in any tool. Reset zoom / fit presets in native mode anchor the top-center instead
  of jumping to the document start (`useReaderZoomControls.setViewZoomCentered`). `getFitMetrics`
  reports the 100% size in native mode so fit-width/fit-page presets stay correct.
- **Layout:** after `getDocument`, page 1's viewport sizes all slots immediately; every page is then
  measured in the background (yielding every 50 pages) and, if any size differs, applied in one
  update with the reading position anchored (no jump).
- **Lazy rendering:** one rAF-throttled pass on scroll / resize (`ResizeObserver`) / zoom / layout
  change. It binary-searches the first visible slot, scans the visible range, renders
  `visible ± 2` pages (canvas + PDF.js `TextLayer`) and releases pages more than 6 away (render
  task cancelled, canvas backing store zeroed, `page.cleanup()`). Canvas backing store is capped at
  16 MP (HiDPI × high zoom). On zoom, the old canvas stays stretched in its slot until the sharp
  re-render replaces it. All tasks are cancelled and the document destroyed on unmount / new data.

## Shared navigation integration

`PdfRenderer` exposes `PdfRendererApi` via `apiRef` (mirrors `EpubRendererApi`):
`goToPage`, `nextPage`, `prevPage`, `getNavState`, `getCurrentLocation` (`PageRectLocation`), plus
callbacks `onNavState({ pageCurrent, pageTotal })` and `onOutline(items)`.

`useReaderNavigation` takes `isPdfSurface` + `pdfApiRef` and branches like it does for EPUB:

| Shared control | EPUB (unchanged) | PDF |
|---|---|---|
| Footer `<` / `>`, ArrowLeft/Right, PageUp/Down (`switchPage`) | epubjs prev/next | scroll to previous/next page |
| Footer page box / Go to Page (`goToPage`) | reference page | scroll to page N |
| `<<` / `>>`, Home/End (`goToStart` / `goToEnd`) | first spine / end | page 1 / last page |
| Progress bar seek (`goToProgress`) | spine fraction | page fraction |
| Page-layout thumbnails (`goToPageFromLayout`) | spine section | page |
| TOC entry (`handleSelectTocItem`) | `goToHref` | `pdf-page:N` href → page N |

- Footer gets real page numbers (`pageCurrent/pageTotal` from `nav.pdfNav`); the
  paginated/scroll toggle is hidden for PDF (always continuous, page numbers always shown).
- Keyboard: no PDF-specific key handler any more — the registry shortcuts in `useReaderShortcuts`
  call `switchPage` etc.; `surfaceReady` now also waits for the PDF renderer. ArrowUp/Down and the
  wheel scroll natively. Focus guards, customization and Escape handling are untouched.
- TOC: the PDF outline (`doc.getOutline()`, named and explicit destinations resolved to pages) is
  mapped into the shared `TocTree` items. A PDF without an outline shows "This book has no table of
  contents." instead of fake chapters.

## Page tracking and persistence

- **Current page** = the page with the largest visible height in the viewport (ties → the first,
  so with several small pages on screen the top one counts). After a programmatic jump the target
  page stays current while it is on screen, so Next at the very end of the document doesn't get
  "pulled back" by geometry, and repeated Next presses step from the target.
- **Persistence** uses the existing `overlay:saveSessionState` path — no schema change. The location
  is `PageRectLocation(page).toString()` in `lastReadLocation` (same column EPUB uses for its CFI;
  a book only ever has one format), label `Page N`, percent = page / total. The shared autosave hook
  was widened from `CfiLocation` to `Location`; it already debounces (750 ms, max 5 s) and flushes on
  blur / leave / quit. `useReaderSessionBridge.handlePdfNavState` skips repeats of the same page.
- **Restore:** `parseResumeLocation` accepts `PageRectLocation`; the PDF mounts only after the
  session loaded (like EPUB) and scrolls to the saved page on first layout. EPUB still only ever
  receives a `CfiLocation`.

## Verification

Automated (2026-10-10):
- `npm run typecheck` — pass.
- `npm run lint` — fails with 12 errors / 14 warnings, all pre-existing (baseline before this
  change: 12 errors / 15 warnings); none in the files this change touched beyond pre-existing lines
  of `hooks/reader/useReaderBookOpen.ts`.
- `npx vite build` — pass.
- No test runner exists in the repo.

Manual: not yet performed in the running Electron app — scrolling, page indicator, Prev/Next,
Go to page, shortcuts, restore, zoom and EPUB regression still need a pass with a real PDF.

## Remaining limitations / follow-ups

- Bookmarks and highlights still use the placeholder chapter model for PDF (no PDF annotations —
  out of scope); the footer bookmark button is therefore not meaningful for PDF yet.
- Footer single/double page layout buttons have no effect on PDF (single column only).
- Hand-tool drag panning is not wired for PDF (scrollbars, wheel and keys work); text selection works
  in both tools.
- Search, read-aloud and translate are not available for PDF (capabilities unchanged: the PDF
  surface still uses the `placeholder` capability set).
- Outline entries pointing to URLs are listed but not clickable; active TOC entry is not highlighted.
- Restore is page-level (top of the saved page), not the exact offset within the page.
