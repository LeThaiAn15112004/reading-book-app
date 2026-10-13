# Page layout panel: PDF only

Status: implemented, not committed. Date: 2026-10-13. Builds on the uncommitted PDF TOC sync
work (`pdf_toc_sync.md`), which this change leaves untouched.

## 1. Issue and root cause

The left sidebar rail (`SidebarEdgeRail`) showed every entry in `SIDEBAR_TABS`, for every format,
and `TocSidebar` rendered `PageLayoutPanel` whenever the selected tab was `layout`. So EPUB showed
"Page layout" too. The cards there stood for spine sections, which duplicates the Contents tab, the
real EPUB navigation surface.

Nothing tied sidebar tabs to the reader's existing capability registry
(`src/reader/capabilities.ts`), which already decides per surface which toolbar tools exist.

## 2. Visibility rules

| Surface (format) | Page layout rail button | Panel can open | Other tabs |
|---|---|---|---|
| PDF | shown | yes, with one card per page that jumps on click (unchanged) | unchanged |
| EPUB | **hidden** (removed, not disabled) | **no**: any request resolves to Contents | unchanged |
| Placeholder (txt, md, docx, doc) | shown | yes (unchanged) | unchanged |

The rule is a new capability, `pageLayout`, held by the `pdf` and `placeholder` surfaces and not
by `epub`. The tab entry declares `requires: 'pageLayout'`. Other formats keep exactly their
previous behaviour.

## 3. Files changed

| File | Change |
|---|---|
| `reading-book-desktop/src/reader/capabilities.ts` | New `pageLayout` capability, on `pdf` and `placeholder` only |
| `reading-book-desktop/src/screens/Reader/components/sidebar/sidebarTabs.ts` | `SidebarTabDef.requires`; pure helpers `isSidebarTabAvailable`, `sidebarTabsFor`, `resolveSidebarTab` |
| `reading-book-desktop/src/screens/Reader/components/sidebar/SidebarEdgeRail.tsx` | Optional `tabs` prop (defaults to all tabs) |
| `reading-book-desktop/src/screens/Reader/components/sidebar/index.ts` | Exports the helpers |
| `reading-book-desktop/src/screens/Reader/ReaderScreen.tsx` | Builds `sidebarTabs` and the resolved `sidebarTab`, and wraps `openSidebarTab`; rail, `TocSidebar` and shortcuts use them |
| `reading-book-desktop/spikes/reader-toolbar/run-toolbar.mjs` | Adds section 8 (sidebar tabs) and updates the placeholder ⊂ EPUB check |
| `reading-book-desktop/e2e/specs/page-layout.spec.ts` | **New**: E2E 1–3 |

Unchanged:

- `PageLayoutPanel`, `usePageLayoutGrid`, the PDF renderer and navigation;
- the EPUB TOC and navigation;
- `useReaderChromeUi` state;
- the database schema.

No new dependencies.

## 4. Entry points and stale state

Every way to open a sidebar tab was listed by searching for `setSidebarTab`, `openSidebarTab`,
`'layout'` and `PageLayoutPanel` across `src/` and `electron/`.

| Entry point | Handling |
|---|---|
| Rail button | Not rendered on EPUB: `tabs={sidebarTabs}` |
| `openSidebarTab(tab)` (the rail's `onOpenTab`, and the shortcut hook) | `ReaderScreen` wraps it: `chrome.openSidebarTab(resolveSidebarTab(tab, caps))`, so `layout` turns into `chapters` on EPUB |
| Edge handle "Open sidebar" (`toggleSidebar`) | Reopens the stored tab, but what renders is the **resolved** tab, so EPUB shows Contents |
| `T` shortcut (`navigation.toggleToc`) | Already opens `chapters` only; it now reads the resolved tab |
| Menus or commands that open Page layout | None exist (the search found none) |
| Persisted state | None: `sidebarTab` is plain `useState`, reset to `chapters` when `bookId` changes |

**Stale state.** `ReaderScreen` never passes `chrome.sidebarTab` straight to the UI. It passes
`resolveSidebarTab(chrome.sidebarTab, readerCapabilities)`, which is computed during render, so a
leftover `layout` value can never render on EPUB. That covers a tab left over from a PDF, and the
short window before `bookFormat` loads. Switching reader tabs already resets the sidebar to Contents
and closed, because `bookId` changes. The resolution is the backstop that does not depend on that
reset. When the user is back on PDF, `layout` resolves to itself again.

Not touched: bookmarks, annotations and reading progress. E2E 3 checks that the PDF page and the
EPUB chapter are kept across tab switches.

## 5. Test results

### Unit-level checks (`npm run spike:reader:toolbar`)

The desktop app's convention is a standalone spike script per area; there is no unit-test runner
in this app. The existing toolbar spike already checks the capability registry, so its
**section 8** was added there. **29/29 checks passed.** Section 8 checks:

- the `pageLayout` capability is on PDF and placeholder only;
- the PDF rail keeps all 5 tabs;
- the EPUB rail hides only Page layout;
- txt, md, docx, doc and null keep every tab;
- asking for `layout` on EPUB resolves to `chapters`, and every other tab is unchanged;
- a stale `layout` resolves to Page layout on PDF, Contents on EPUB, then Page layout on PDF again;
- `ReaderScreen` passes the resolved tab and the wrapped opener to the rail, `TocSidebar` and the
  shortcuts. This is a static source check.

The existing check "placeholder is a strict subset of EPUB" now excludes `pageLayout`. It was the
first check to fail when the capability was added, which is intended.

### Integration

There is no component or integration runner for the desktop app. The `ReaderScreen` wiring is
covered by the static check above and by E2E against the real app. The SDK was not changed;
`npm run verify` still passes (55 tests).

### E2E (Playwright, built Electron app)

Fixtures: the generated 30-page `toc.pdf` (`e2e/support/build-toc-pdf.mjs`) and the tracked
`public/spikes/spike-sample.epub`.

**E2E 1 — PDF: passed.**

- The rail shows Page layout.
- The panel shows 30 page cards.
- Clicking "Page 12" moves the page indicator to 12; page 12 with its "Page 12 marker" is in view
  and the card is marked `aria-current`.
- Clicking "Page 3" moves the indicator to 3.

**E2E 2 — EPUB: passed.**

- No Page layout rail button, panel heading or `Go to …` cards.
- The edge handle opens Contents, and so does the `T` shortcut. Page layout never appears.
- Clicking "Chapter Two" in the TOC navigates, and Chapter Two is highlighted.

**E2E 3 — PDF → EPUB → PDF → EPUB: passed.**

- On the PDF, Page layout opens and jumps to page 7.
- From the Library, adding the EPUB opens it in a second reader tab, which is selected.
- On the EPUB there is no Page layout through any entry point, and the TOC still navigates.
- Back on the PDF tab, the page is still 7; Page layout works and jumps to page 20.
- Back on the EPUB tab, Chapter Two is still shown and there is still no Page layout.

**Checked against deliberately broken builds.** With `pageLayout` added back to EPUB, E2E 2 and
E2E 3 failed (the Page layout button was found), the spike failed, and E2E 1 still passed.

**Stability:**

- `--repeat-each=3` on the new spec: 9/9 passed.
- Full suite, which also re-runs the 8 earlier TOC specs: 11/11 passed.

## 6. Commands run

| Command (working directory) | Result |
|---|---|
| `npm run typecheck` (desktop) | passed |
| `npm run lint` (desktop) | passed |
| `npm run e2e:typecheck` (desktop) | passed |
| `npm run spike:reader:toolbar` (desktop) | passed, 29 checks |
| `npm run verify` (SDK) | passed: 7 files, 55 tests |
| `npx playwright test -c e2e/playwright.config.ts page-layout` (desktop) | passed 3/3 |
| `npm run e2e` (desktop: `vite build` + all specs) | passed 11/11 |
| `npm run e2e:only -- page-layout --repeat-each=3` (desktop) | passed 9/9 |
| `npm run build` (desktop: `tsc && vite build && electron-builder`) | 1st run **failed**, 2nd **passed** (§6.1) |

### 6.1 Production build

- **First run: failed.** `tsc` and `vite build` passed. electron-builder then failed with
  `EPERM: operation not permitted, rename 'release/0.0.0/win-unpacked.tmp' -> 'release/0.0.0/win-unpacked'`.
  That is a Windows file lock on the packaging output folder, not a code error.
- **Second run, unchanged code: passed.** `npm run build` exited 0 and electron-builder wrote
  `release/0.0.0/Readmate Reader-Windows-0.0.0-Setup.exe` and its blockmap.

## 7. Not run

- **E2E in CI.** The CI job does not download Electron; there is still no E2E job (see
  `e2e_testing/e2e_testing_survey.md` §8). E2E ran locally on Windows 11 only.
- **Placeholder formats in E2E** (txt, md, docx, doc). Their behaviour is unchanged by design and
  covered by the spike; no E2E opens them.
- **The leftover-tab backstop in the real app.** Switching reader tabs resets the sidebar first,
  so the real app never shows a leftover `layout` value. The backstop is covered by the spike only.

## 8. Remaining limitations

- `useReaderChromeUi` still stores the raw tab value, so it can hold `layout` while EPUB shows
  Contents. That is harmless, because only the resolved value reaches the UI, and it keeps the hook
  unchanged.
- The EPUB TOC can drop a jump issued right after the book or the sidebar opens. This bug existed
  before this change (`pdf_toc_sync.md` §9). The E2E helper re-clicks until the jump lands.
- Superseded by §9: PDF cards now show the real rendered page.

## 9. Follow-up: real PDF thumbnails, responsive columns

The request: PDF is fixed layout, so Page layout should draw the real pages. Remove the −/+
column buttons; the number of columns should follow the width of the left sidebar.

### What changed

- **`PdfRendererApi.renderThumbnail(page, cssWidth, signal)`** (`PdfRenderer.tsx`):
  - draws the page from the already-open PDF.js document into a new canvas, at device pixel ratio;
  - renders run one after another through a promise queue, so scrolling the grid cannot flood
    PDF.js with requests;
  - an `AbortSignal` cancels the PDF.js render task;
  - returns `null` when the render was aborted or the document is not loaded.
- **`PageLayoutPanel.tsx`** (rewritten):
  - **Grid:** `repeat(auto-fill, minmax(104px, 1fr))`. Resizing the sidebar changes the column
    count; no JavaScript or state is involved.
  - **Lazy drawing:** a card is drawn when an `IntersectionObserver` sees it near the visible part
    of the list (200 px margin).
  - **Redraw on widening:** a `ResizeObserver` measures the card. It is redrawn only when it grows
    past 1.25× the width it was drawn at. Narrowing just scales the existing canvas.
  - **Aspect ratio:** the card takes the real page's ratio once drawn.
  - **Number overlay:** removed for real thumbnails; the "Page N" label below the card stays.
    Placeholder cards keep their numbered placeholder look.
- **`TocSidebar` / `ReaderScreen`:**
  - new `renderPageThumbnail` prop, passed only for the PDF surface;
  - the `PageLayoutZoomControls` (−/+) buttons are removed.
- **Deleted:** `usePageLayoutGrid.ts` and `pageLayoutGrid.ts`, the column-step state used only by
  those buttons.
- **Other formats:** only the placeholder surface (txt, md, docx, doc) still shows Page layout,
  with placeholder cards that now use the same responsive grid.

### Tests

**E2E 1 now also checks:**

- page 1's card has a drawn `<canvas>` containing dark pixels, i.e. the real "Page 1 marker" text;
- page 30, out of view, is not drawn yet (lazy rendering);
- the "section cards" zoom buttons are gone;
- dragging the "Resize sidebar" separator 260 px wider increases the number of columns.

**Results:**

| Command (desktop) | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm run e2e:typecheck` | passed |
| `npx playwright test -c e2e/playwright.config.ts page-layout` | 3/3 passed |
| `npm run e2e` | 10/11. `pdf-toc-sync` E2E 3 failed: `mouse.wheel: Target page, context or browser has been closed`. That spec does not open Page layout. |
| `npm run e2e:only -- pdf-toc-sync -g "E2E 3" --repeat-each=5` | 5/5 passed |
| `npm run e2e:only` (twice) | 11/11 passed both times |

The one closed-window failure could not be reproduced; its cause is unknown.

**`npm run build`: failed 3 times.** `tsc` and `vite build` pass each time; electron-builder then
fails with `EPERM: operation not permitted, rename 'release/0.0.0/win-unpacked.tmp' ->
'release/0.0.0/win-unpacked'`.

- No running process uses that folder.
- Deleting the leftover `win-unpacked.tmp` before the third try did not help.
- This looks like a Windows file lock, probably antivirus scanning the freshly extracted Electron.
- The installer has **not** been rebuilt with this change.

### Limitations

- **Thumbnail memory.** Thumbnails are never released once drawn, so a very long PDF that is
  scrolled end to end in Page layout keeps one small canvas per page. The size is roughly the
  card width × device pixel ratio.
- **Shared renderer.** Thumbnails reuse the reading document's PDF.js worker. They are queued among
  themselves, but not prioritised below the reading pages' renders.
