# PDF Fit page

Date: 2026-10-15.

## Behaviour

A **Fit page** button sits in the reader footer next to the zoom control. It appears for **PDF only**;
EPUB and the other formats don't pass `onFitPage`, so the button is not rendered. Pressing it:

1. **Measures the page being read.** It calls `PdfRendererApi.measurePage(page)`, which reads the
   page from the PDF document itself (its own MediaBox and rotation) in CSS px at 100%.
2. **Computes the zoom.** It uses `pdfFitPageZoom` in `pdfLayout.ts`:
   `min(viewportW / (pageW + 2·PAD), viewportH / (pageH + 2·GAP))`, floored to 0.1%. The side
   padding and the gap above and below the page scale with zoom, so they are part of the divisor.
   The viewport is the PDF's own scroll container, so the result follows the current window, sidebar
   and fullscreen state.
3. **Applies it.** It sets the zoom. After the surface has re-laid out, it scrolls the same page to
   the top of the view and centres it horizontally.

Every page is measured on its own, so a landscape or small page in a mixed document gets its own
fit. A small page can fit above 100%.

For PDF, the existing zoom menu entry **Fit Page** now runs the same action. Its old behaviour
fitted the whole page column, not a page. The other zoom presets are unchanged.

## Files

| File | Change |
|---|---|
| `src/reader/renderers/pdf/pdfLayout.ts` | **new**: layout constants (`PDF_TO_CSS`, `PAGE_GAP_PX`, `PAD_PX`) moved here from `PdfRenderer`; `pdfFitPageZoom` |
| `src/reader/renderers/pdf/PdfRenderer.tsx` | imports the constants; new API method `measurePage` |
| `src/reader/renderers/pdf/index.ts` | exports `pdfFitPageZoom`, `PdfPageCssSize` |
| `src/screens/Reader/logic/hooks/useReaderZoomControls.ts` | `setZoomThen(zoom, after)` |
| `src/screens/Reader/components/chrome/ReaderFooter.tsx` | optional `onFitPage` and the Fit page button |
| `src/screens/Reader/ReaderScreen.tsx` | `fitPdfPage`; wires the button and the PDF "Fit Page" preset |
| `e2e/support/build-mixed-pdf.mjs` | **new** fixture: portrait 612×792, landscape 792×612, small 300×400 pt |
| `e2e/specs/pdf-fit-page.spec.ts` | **new** E2E |

## Tests

`e2e/specs/pdf-fit-page.spec.ts` runs against the built Electron app.

- **Mixed PDF.** On each of pages 1, 2 and 3, Fit page keeps that page current. The page ends up
  fully inside the reading area and fills it in width or height (±3 px). The zoom equals the rule
  computed from that page's own size. The landscape page gets a different zoom from the portrait
  page, and the small page goes above 100%. Pressing Fit page a second time changes nothing.
- **30-page PDF.** At page 17, after zooming in, Fit page keeps page 17 and fits it. At page 9, the
  zoom menu "Fit Page" fits page 9 and gives the same zoom.
- **EPUB.** The Fit page button is absent.

Results:

| Run | Result |
|---|---|
| `pdf-fit-page.spec.ts` | 3/3 passed |
| Full suite (`npm run e2e:only`) | 14/14 passed |
| `npm run typecheck`, `npm run lint`, `npm run e2e:typecheck` (desktop) | passed |

**Do the tests catch a broken fit?** Making Fit page always measure page 1 made the mixed-page
test fail.

## Limitations

- **Fit is one-shot.** The zoom is not re-fitted when the window or sidebar is resized later; press
  Fit page again.
- **No shortcut.** Fit page has no keyboard shortcut; it is only reachable from the button and the
  zoom menu.
