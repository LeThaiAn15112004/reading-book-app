# PDF TOC sync with the current page

Status: implemented, not committed. Date: 2026-10-13.

## 1. Issue and root cause

The PDF outline already showed in the Contents sidebar (`nav.pdfToc`), and clicking an entry
already jumped to its page. The sidebar never marked the entry for the current page, though.

Root cause, in `ReaderScreen.tsx`:

```tsx
activeTocHref={book.isEpubSurface ? nav.epubNav?.href : undefined}
```

For PDF this was always `undefined`, so `TocSidebar` had nothing to match. Two more gaps:

- **Matching by href does not work for PDF.** `TocSidebar` matched entries by `href`. PDF entries
  carry `pdf-page:N` hrefs, so every entry on the same page would light up together.
- **No auto-scroll.** The sidebar had no code to bring the active entry into view.

## 2. How the active entry is chosen

The rule lives in a pure SDK function,
`resolveActivePageTocEntry(items, currentPage, pageOf, preferredId?)`, in
`book-reader-sdk/src/app-models/page-toc.ts`. It works on the TOC flattened in document order
(pre-order: a parent before its children, siblings in their listed order).

1. **Invalid destinations are skipped.** An entry whose destination is not a positive whole page
   number is ignored: `null` (a URL or broken destination), 0, a negative number, a fraction or
   NaN. It is never treated as page 1. Its children are still checked.
2. **Winning page.** The winning page is the largest destination page that is `<= currentPage`.
3. **Ties on that page:**
   - If `preferredId` (the entry the reader just clicked) is on the winning page, it wins.
   - Otherwise the last entry in document order wins. For a parent and child on the same page,
     that is the child, the most specific section that has started. For siblings on the same
     page, it is the later sibling.
4. **No result.** The function returns `null` if the current page is invalid, or if every usable
   destination comes after the current page.

What this means in practice:

- **Nesting.** A parent is active from its own page until its first child's page.
- **Later siblings.** An entry on a later page is never active, however close it is. While you
  read page 5, a sibling that starts on page 6 stays unmarked.
- **Ancestors.** Ancestors of the active entry keep the existing "parent of active" styling in
  `TocSidebar`.
- **Out-of-order outlines.** Entries whose pages are not in ascending order are resolved by page,
  not by position in the list. An appendix listed first only wins once you reach its page.

**Limitation.** Precision is one page. Two sections on the same page cannot be told apart by
scroll position: the rule picks the later one unless the reader clicked the other one.

## 3. Integration

- **`useReaderNavigation`.** It computes `pdfActiveTocId` with `useMemo`, keyed on the page
  *number* (`pdfNav.pageCurrent`), the TOC and the clicked id. Nav reports that keep the same page
  (zoom, re-layout) do not trigger a new calculation. No page state is duplicated: it reuses the
  existing `pdfNav` and `pdfToc`. `pdfTocItemPage()` reads the page back from the existing
  `pdf-page:N` href and returns `null` for anything invalid. The TOC click handler uses the same
  helper. Before, the handler used `parseInt`.
- **`pdfTocStore` (zustand).** It holds `pickedId`, the last clicked PDF TOC entry, used only to
  break same-page ties. It is cleared when the book changes.
- **`ReaderScreen`.** For PDF it passes `activeTocItemId={nav.pdfActiveTocId ?? null}`. EPUB
  still passes `activeTocHref={nav.epubNav?.href}` and leaves `activeTocItemId` undefined.
- **`TocSidebar`:**
  - New prop `activeTocItemId?: string | null`. When it is defined, entries are matched by id;
    `null` means no entry is active. Otherwise the existing href matching is used.
  - The active entry button gets `aria-current="location"`, for both formats. This is the
    accessible hook the E2E specs use.
  - **Auto-reveal, PDF only.** When the active entry changes, or the Contents tab is shown, an
    effect scrolls the list only if the entry is outside the visible area, and only by the amount
    needed. It runs once per change of the active key, never on every render. So fast page
    tracking cannot fight a manual scroll, and a list that the reader scrolled by hand stays put
    while the entry is still visible. If the entry is not in the DOM, nothing happens. EPUB does
    not get auto-reveal, so its sidebar behaves exactly as before.

## 4. Files changed

| File | Change |
|---|---|
| `book-reader-sdk/src/app-models/page-toc.ts` | **new**: `resolveActivePageTocEntry`, `PageTocNode` |
| `book-reader-sdk/src/app-models/index.ts` | export it |
| `book-reader-sdk/tests/app-models/page-toc.test.ts` | **new**: 14 unit tests |
| `reading-book-desktop/src/screens/Reader/logic/pdfToc/pdfTocStore.ts` | **new**: clicked-entry tie-break store |
| `reading-book-desktop/src/screens/Reader/logic/hooks/useReaderNavigation.ts` | `pdfActiveTocId`, `pdfTocItemPage`, records the clicked entry |
| `reading-book-desktop/src/screens/Reader/ReaderScreen.tsx` | passes `activeTocItemId` for PDF |
| `reading-book-desktop/src/screens/Reader/components/sidebar/TocSidebar.tsx` | id matching, `aria-current`, auto-reveal |
| `reading-book-desktop/e2e/**` | **new**: Playwright harness, fixture generator, specs |
| `reading-book-desktop/package.json` | scripts `e2e`, `e2e:only`, `e2e:typecheck` |
| `reading-book-desktop/.gitignore` | ignores `e2e/test-results`, `e2e/playwright-report` |

The database schema is unchanged and PDF outline extraction (`PdfRenderer.resolveOutline`) is
unchanged. No new dependencies: `@playwright/test` 1.64.0 was already a devDependency.

## 5. Unit and integration tests

- **Unit tests** (`page-toc.test.ts`, vitest, 14 tests, all passed). They cover:
  - an empty TOC;
  - the current page before the first destination;
  - an exact match, and a page between two destinations;
  - nesting: parent first, then child;
  - no activation of a nearby later sibling;
  - same-page ties (parent/child and siblings);
  - the clicked-entry tie-break, including ignoring it when it is not on the winning page;
  - missing, invalid, 0, negative, fractional and NaN destinations;
  - children of an entry without a destination;
  - an invalid current page;
  - a sweep over pages 1–9;
  - repeated-call determinism and no mutation of the input;
  - out-of-order outlines.
- **Integration tests.** The desktop app has no component or integration test runner. Its only
  automated checks are spikes and, now, E2E. So `ReaderScreen` and `TocSidebar` have **no
  mocked integration tests**. Instead, these points are checked through the real app in E2E:
  - `ReaderScreen` passes the right identifier for PDF (E2E 1–6);
  - EPUB still uses href matching (E2E 7);
  - a page change updates the active entry (E2E 3–5);
  - the reveal fires when needed (E2E 2, 3);
  - zoom alone does not change the entry (E2E 8).

  The SDK integration test `tests/integration/reader-flow.test.ts` needed no change: the SDK API
  only gained a new function.

## 6. E2E

The harness follows `e2e_testing/e2e_testing_survey.md`:

- **How it runs.** Playwright's Electron API drives the **built** app (`dist-electron/main.js`).
- **Isolation.**
  - Each test gets a throwaway `--user-data-dir`. The harness refuses to run if the
    `userData` path Electron reports is not that directory.
  - `READMATE_E2E=1` stops the test instance from re-registering the user's real
    `readmate-reader://` handler.
- **Import.** Books are imported through the real "Add file" button, with `dialog.showOpenDialog`
  stubbed in Main.
- **Cleanup.** The temp directory is deleted after each test.
- **Selectors.** Roles and accessible names only: `Current page`, `Next page`, `Previous page`,
  `Zoom in`, `Zoom out`, `Contents`, the TOC entry labels, and `aria-current="location"`.

Fixtures:

- **PDF.** `e2e/support/build-toc-pdf.mjs` generates a deterministic 30-page PDF at test time. It
  has no external tools and is not committed. Page N shows "Page N marker". The outline:
  - Part One (p1) › Section 1.1 (p2), Section 1.2 (p4)
  - Part Two (p6) › Section 2.1 (p6), Section 2.2 (p8)
  - Appendix (p10) › A.1 (p11) … A.20 (p30). This branch is long enough that the sidebar list
    has to scroll.
- **EPUB.** The existing tracked `public/spikes/spike-sample.epub` (Chapter One, Chapter Two).

| # | Scenario | Result |
|---|---|---|
| E2E 1 | Open PDF → Contents → "Part One" active and visible | **passed** |
| E2E 2 | Click Section 2.2 → page 8 shown with its marker, entry active and visible; click Part Two (shares p6 with Section 2.1) → Part Two active; click A.20 → page 30, entry active and visible | **passed** |
| E2E 3 | Real mouse-wheel scroll to page ≥ 4 → entry matches the rule once the page settles; list reset to top, document scrolled to page ≥ 25 → expected A.x active **and scrolled into view** | **passed** |
| E2E 4 | Next ×5 / Previous ×3 → entry follows the rule on every step | **passed** |
| E2E 5 | Go to page 9, 5, 17, 1 → page in viewport, entry correct | **passed** |
| E2E 6 | Nested: p1 Part One, p2–3 Section 1.1 (1.2 not active on p3), p6–7 Section 2.1 (Part Two not active), p10 Appendix, p11 A.1; click Part One → Part One | **passed** |
| E2E 7 | EPUB: Chapter One active; TOC to Chapter Two / back; Next page into Chapter Two → highlight follows | **passed** |
| E2E 8 | On p8, Zoom in ×2, Zoom out ×3 → page stays 8, Section 2.2 stays active and visible, **0** scroll events on the TOC list, no page errors | **passed** |

**Do the specs catch real bugs?** They were checked against deliberately broken builds:

- With `activeTocItemId` not passed for PDF, all 7 PDF specs failed.
- With the auto-reveal effect disabled, E2E 3 failed on `toBeInViewport` (viewport ratio 0).

**Stability:**

- Two full sequential runs (`npm run e2e`, `npm run e2e:only`) passed 8/8 each.
- Earlier, `--repeat-each=2` of the PDF specs passed 14/14.
- EPUB E2E 7 passed 5/5 with `--repeat-each=5`.
- One attempt to run the suite **while SDK `npm run verify` ran in parallel** exited 1. Its output
  was not captured, so its failing tests are unknown. Every sequential run since has passed.

## 7. Commands

| Command (cwd) | Result |
|---|---|
| `npx vitest run tests/app-models` (SDK) | passed: 2 files, 20 tests |
| `npm run verify` (SDK: typecheck, test typecheck, tests, build) | passed: 7 files, 55 tests |
| `npm run typecheck` (desktop) | passed |
| `npm run lint` (desktop, includes `e2e/`) | passed |
| `npm run e2e:typecheck` (desktop) | passed |
| `npm run e2e` (desktop: `vite build` + Playwright) | passed 8/8 |
| `npm run e2e:only` (desktop) | passed 8/8 |
| `npm run build` (desktop: `tsc && vite build && electron-builder`) | passed (see §7.1) |

### 7.1 Production build

Passed (exit 0): `tsc`, `vite build`, then electron-builder produced
`release/0.0.0/Readmate Reader-Windows-0.0.0-Setup.exe` and its blockmap.

## 8. E2E limitations

- **No CI job.** E2E needs a display and the real Electron binary. The existing CI job skips the
  Electron download, so these specs **do not run in CI**. A separate job is proposed in the
  survey, §8.
- **Platform.** The suite was run on Windows 11 only.
- **Page precision.** The specs read the current page from the footer field. The matching rule is
  page-based, so that is the intended level of detail.

## 9. Pre-existing bug found (not fixed, out of scope)

**An EPUB TOC jump can be dropped right after the book or the sidebar opens.** In this flow:
open the book, wait for the Chapter One heading, open Contents, wait for the reader to stop
resizing, then click "Chapter Two". The click did nothing in **6 of 6 runs, both on the build
before this change (HEAD) and with it**. With a 1.5 s pause before opening Contents, it failed
1 of 10 times on HEAD.

Likely cause: `goToHref` in `openEpubjs.ts` calls `activeRendition.display(href)` without going
through `withRenditionLock`. The resize the sidebar triggers, and its anchor restore, can then
win. The comment above `withRenditionLock` describes exactly this kind of race. E2E 7 works
around it by clicking again until the jump lands, because that spec checks the highlight, not
the jump.

Suggested follow-up: route `goToHref`, `goToSpineIndex` and `goToLocationPage` through
`withRenditionLock`. Then add an E2E spec that clicks once and asserts that the jump happens.

## 10. Remaining follow-up

- Add a CI E2E job (Windows, or Ubuntu with `xvfb-run`) using `npm run e2e`.
- Possibly enable auto-reveal for EPUB once the race in §9 is fixed.
- Manual check in the dev Electron app is still recommended:
  - a real-world PDF with a deep or out-of-order outline;
  - two-page layout, where the current page is the left page of the pair.
