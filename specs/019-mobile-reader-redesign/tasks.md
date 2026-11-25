---

description: "Task list for spec 019 — phone reader redesign"
---

# Tasks: Phone reader — a reading screen made for the phone

**Input**: Design documents from `specs/019-mobile-reader-redesign/` (plan.md, spec.md, research.md R1–R13,
data-model.md, contracts/phone-reader-ui.md, contracts/reading-surface.md, contracts/mobile-txt-commit.md, quickstart.md)

**Tests**: the plan names vitest tests (core `reader-gesture`, `reader-place`, `phone-reader-chrome`, i18n gates;
Mobile `txt-commit`). They are written before the code they cover. Desktop UI / phone UI have no test runner: their
checks are the quickstart rows (manual, device). E2E is manual-only and is NOT run by any task.

**Organization**: Phase 2 is the structural phase the spec requires first (FR-020 – FR-023: one reading surface, one
chrome store). Stories then follow the plan's delivery order: US1 → US6 → US3 → US2 → US4 → US5.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 … US6 = spec.md User Story 1 … 6
- Paths are from the repository root

---

## Phase 1: Setup (shared vocabulary)

**Purpose**: catalogue keys and glossary rows every later task uses (no literal UI text, `no-ui-literals`).

- [ ] T001 Add the new Vietnamese terms to `specs/012-app-ui-i18n/contracts/glossary.md` BEFORE any catalogue text:
  Page (view) = "Trang", Scroll (view) = "Cuộn", Show reading controls = "Hiện thanh điều khiển",
  "Page {page} of {total} in chapter" = "Trang {page}/{total} trong chương", Fit page = "Vừa trang" (no "bạn")
- [ ] T002 Add `reader.phone.*` keys to `source/core/src/i18n/catalogue/en/reader-phone.ts`: view names (`viewPage`,
  `viewScroll`), place texts (`placePageInChapter {page,total}`, `placePage {page,total}`, `placePercent {value}`),
  `showControls`, `previousPage` / `nextPage`, icon button names (back, bookmark add / remove, contents, notes,
  appearance, zoom in / out / fit, underline, strike, note, copy, close, delete), Appearance section titles (theme
  Paper / Sepia / Night / System, view, zoom, font size, font family, line spacing, margins), delete-mark confirm texts
- [ ] T003 Add the same keys with the same shape to `source/core/src/i18n/catalogue/vi/reader-phone.ts` using the
  glossary rows of T001 (TypeScript fails if a key is missing); run `npm run sdk:test` (i18n release gate,
  `tests/i18n/glossary-anchors.test.ts`)
- [ ] T004 [P] Record `phoneReaderChromeStore` and its reason ("Back, auto-hide and swipes need one holder per open
  book, FR-021; session-only, reset on book change") in `specs/008-shared-core-architecture/contracts/phone-ui.md`

---

## Phase 2: Foundational — one reading surface, one chrome state (FR-020 – FR-023)

**Purpose**: the structure Stories 1–3 are built on. Behaviour on the phone stays as today at the end of this phase;
Desktop is unchanged.

**⚠️ CRITICAL**: no user-story task starts before this phase is done.

### Core rules (pure, tested first)

- [ ] T005 [P] Write `source/core/tests/app-models/phone-reader-chrome.test.ts` covering every row of data-model.md
  "Events and effects": `open-book(bookId)` resets and sets `barsVisible = false`; a different `bookId` resets every
  other field; `tap-middle` toggles bars only when `layers` is empty, else closes the top layer; `page-turned` /
  `scrolled` set `barsVisible = false` and leave layers; `idle-elapsed` hides only if `layers` empty and not
  `sliderDragging`; `layer-open(l)` pushes `l` with no duplicates (an existing `l` moves to the top);
  `layer-close(l)` removes `l` and every layer above it and leaves `barsVisible` unchanged (FR-002);
  `slider-drag(on)`; derived `swipesAllowed = layers.length === 0` and
  `idleTimerRunning = barsVisible && layers.length === 0 && !sliderDragging`
- [ ] T006 Implement `source/core/src/app-models/phone-reader-chrome.ts`: types `ChromeLayer = 'selection' | 'toc' |
  'marks' | 'appearance' | 'mark' | 'confirm'`, `ChromeState { bookId: string | null; barsVisible: boolean;
  layers: ChromeLayer[]; sliderDragging: boolean; toast: { id: number; text: string } | null; topInsetPx: number }`,
  `ChromeEvent`, `reduceChrome(state, event)`, `swipesAllowed(state)`, `idleTimerRunning(state)`,
  `CHROME_IDLE_MS = 4000`, `CHROME_TOAST_MS = 2400`; no DOM / React (R1–R3); make T005 pass
- [ ] T007 [P] Write `source/core/tests/app-models/reader-place.test.ts`: `chapterNameFor` returns the LAST entry with
  `order ≤ currentOrder`, `null` with no entries or before the first entry; `placeFor` per format / view as the
  data-model table (EPUB Page → `pageInChapter(sectionPage, sectionPageTotal)`, `percent` while total is 0; EPUB
  Scroll → `percent`; PDF both views → `page(pageCurrent, pageTotal)`, `percent` instead of "page 0"; Markdown →
  heading or `null` + `percent`; TXT → book title + `percent`); bookmark label `name ?? formatDetail(detail)`
- [ ] T008 Implement `source/core/src/app-models/reader-place.ts`: `ContentsEntry = { title: string; order: number }`,
  `Place = { name: string | null; detail: PlaceDetail }`, `PlaceDetail = { kind: 'pageInChapter'; page; total } |
  { kind: 'page'; page; total } | { kind: 'percent'; value }`, `chapterNameFor`, `placeFor`, `bookmarkLabelFor(place,
  formatDetail)`; pure; make T007 pass
- [ ] T009 [P] Write `source/core/tests/app-models/reader-gesture.test.ts` for the R2 thresholds (`SWIPE_MIN_PX = 48`,
  `SWIPE_RATIO = 1.5`, `SWIPE_COMMIT_SHARE = 0.25`, `SWIPE_COMMIT_VELOCITY = 0.4`, `TAP_MAX_PX = 10`,
  `TAP_MAX_MS = 350`, `EDGE_SHARE = 0.2`): swipe next / prev; short or mostly vertical move → `none`; movement
  started after 350 ms (long press) → `none`; `selectionSeen` / `startedOnMarkOrLink` / `layersOpen` → no swipe and no
  edge tap; commit by distance OR velocity, else `none` (spring back); taps in the left / right 20 % → `tap-prev` /
  `tap-next` in Page view, `tap-middle` elsewhere; `view === 'scroll'` → only `tap-middle` or `none` (FR-006);
  `zoomEdge` set → `swipe-next` only when `zoomEdge.right`, `swipe-prev` only when `zoomEdge.left`, else `none`
  (FR-013b)
- [ ] T010 Implement `source/core/src/app-models/reader-gesture.ts`: input `{ view: 'page' | 'scroll'; start; end:
  { x, y, t }; maxMoveBeforeMs350: { dx, dy }; width; startedOnMarkOrLink; selectionSeen; layersOpen; zoomEdge:
  { left: boolean; right: boolean } | null }`, `GestureResult = { kind: 'swipe-next' | 'swipe-prev' | 'tap-prev' |
  'tap-next' | 'tap-middle' | 'none' }`, exported constants, `classifyGesture(input)`; also export
  `isSwipeCandidate(partial)` used during a move to decide whether the page follows the finger; make T009 pass
- [ ] T011 Export the three modules from `source/core/src/app-models/index.ts`; run `npm run sdk:typecheck`,
  `npm run sdk:test`, `npm run check:boundaries`

### Shared engine: optional props instead of stand-ins (FR-022, FR-023)

- [ ] T012 [P] Make `onEdit`, `onUndo`, `onRedo`, `onSaveShortcut`, `onReplaceHover`, `caretRequest` optional in
  `source/app/components/reader/renderers/txt/TxtRenderer.tsx`; absent = feature off (no editing / undo / shortcut
  handling); Desktop passes them as today, behaviour unchanged
- [ ] T013 [P] Make `onInsertPoint`, `onAnnotationHover`, `draftCaret`, `markupTool` optional in
  `source/app/components/reader/renderers/md/MdRenderer.tsx`; absent = no insert point / hover / tool
- [ ] T014 [P] Make `translateModeActive`, `onTranslateDragEnd`, `onAnnotationDragEnd` optional in
  `source/app/components/reader/renderers/epub/EpubRenderer.tsx`; absent = translate mode off, no drag-end handling
- [ ] T015 [P] Add a rect-less `openHighlightById(id)` to the EPUB highlight store in
  `source/app/screens/Reader/logic/hooks/useReaderHighlights.ts` (keep `openHighlightContextMenu(info)` with its Desktop
  signature)
- [ ] T016 [P] Make the anchor rect optional in the open-highlight calls of
  `source/app/screens/Reader/logic/hooks/useReaderPdfHighlights.ts` and
  `source/app/screens/Reader/logic/hooks/useReaderMdHighlights.ts` (`openHighlight(id)` with no rect = open without
  placement; Desktop keeps passing its rect)
- [ ] T017 Check `source/app/screens/Reader/logic/hooks/useReaderTxt.ts` and the TXT store
  (`source/app/screens/Reader/logic/txtDocument/`) expose `openHighlight(id)` without a rect; add it if missing

### Phone holders

- [ ] T018 Create `source/app/screens/Reader/phone/logic/phoneReaderChromeStore.ts` (zustand, session-only): state =
  core `ChromeState`, `dispatch(event)` through `reduceChrome`, `showToast(text)` (replaces the previous toast, clears
  after `CHROME_TOAST_MS`), `setTopInset(px)`, the idle timer started / stopped from `idleTimerRunning` (fires
  `idle-elapsed` after `CHROME_IDLE_MS`), `resetFor(bookId)`; also exports selectors `useBarsVisible`, `useTopLayer`,
  `useSwipesAllowed` (depends on T006)
- [ ] T019 Create `source/app/screens/Reader/phone/logic/useReadingSurface.ts` returning ONE `ReadingSurface` per
  `contracts/reading-surface.md` (`format`, `view`, `setView?`, `place`, `progress`, `goToProgress`, `turn?`, `toc`,
  `activeTocId`, `goToToc`, `bookmarks?` (absent for TXT), `marks`, `openMark(id)`, `jumpToMark(id)`, `activeMark`,
  `selection`, `lastColorHex`), built from the hooks the screen already runs (`useReaderCore`, `useReaderAnnotations`,
  `useReaderTxt`, `usePdfSelectionMenu`, Markdown heading state); `openMark` uses only the rect-less opens of T015–T017;
  in this phase `place` may still use the existing label source (Story 6 replaces it) — this is the ONLY file in
  `screens/Reader/phone/**` that branches on format
- [ ] T020 Rewrite `source/app/screens/Reader/phone/MobileReaderScreen.tsx` on the surface + chrome store: no
  per-format `switch` / ternaries for progress, place, marks list, jump, open mark, selection; no `useState` for bars /
  panels / toast (read `phoneReaderChromeStore`); pass NO stand-in to renderers (remove `() => {}`, `NO_SHORTCUTS`,
  `translateModeActive={false}`, editing handlers); no `new DOMRect(0, 0, 0, 0)`; call `resetFor(bookId)` on book
  change; current visible behaviour otherwise kept (bars, sheets, selection bar work as before)
- [ ] T021 Point `MobileReaderBars.tsx`, `MobileTocSheet.tsx`, `MobileMarksSheet.tsx`, `MobileMarkSheet.tsx`,
  `MobileSelectionBar.tsx` in `source/app/screens/Reader/phone/components/` at the surface / chrome store props instead
  of per-format props; open / close panels through `dispatch({ type: 'layer-open' | 'layer-close', layer })`
- [ ] T022 Run `npm run typecheck`, `npm run lint`, `npm run e2e:typecheck`, `npm run check:boundaries`,
  `npm run check:platform-adapters`, `npm run build`, `npm run build:web`, `npm run check:build-split`; quickstart row
  18 (SC-009) by reading `screens/Reader/phone/**`; Desktop regression smoke (quickstart "Desktop regression")

**Checkpoint**: phone reader works as before, built on one surface and one chrome store; Desktop unchanged.

---

## Phase 3: User Story 1 — Back always does the expected thing (Priority: P1) 🎯 MVP

**Goal**: Android Back closes the innermost reader layer before it leaves the book (FR-001, FR-002, SC-001).

**Independent Test**: quickstart rows 3–4 — open each panel and press Back; the panel closes, the position is unchanged;
Back again leaves the book.

- [ ] T023 [US1] In `source/app/screens/Reader/phone/components/MobileSheet.tsx` register every open sheet with
  `useBackClose(open, close)` (`source/app/hooks/app/useBackClose.ts`), `close` = `dispatch({ type: 'layer-close',
  layer })` so Back closes the sheet and everything above it, never the bars (FR-002)
- [ ] T024 [P] [US1] Register the Contents (`toc`), Bookmarks / Notes (`marks`) and Appearance (`appearance`) layers in
  `MobileTocSheet.tsx`, `MobileMarksSheet.tsx` and the Appearance sheet host in
  `source/app/screens/Reader/phone/components/` via T023's mechanism
- [ ] T025 [P] [US1] Register the mark panel (`mark`) in
  `source/app/screens/Reader/phone/components/MobileMarkSheet.tsx`, opened over Notes, so Back closes it first
  (acceptance 2)
- [ ] T026 [US1] Add the delete-mark confirmation as a `confirm` layer in `MobileMarkSheet.tsx` with its own
  `useBackClose` (closed first, before the mark panel; edge case "dialog of a panel")
- [ ] T027 [US1] Register the selection bar (`selection`) in
  `source/app/screens/Reader/phone/components/MobileSelectionBar.tsx`; its `close` clears the renderer selection
  through `surface.selection.close()` (acceptance 3)
- [ ] T028 [US1] In `MobileReaderScreen.tsx` keep the opening screen's Back (spec 017, leaves the book) and the
  no-layer Back (leaves the book, position saved) unchanged; check the layer order against
  `contracts/phone-reader-ui.md` "Layers"; quickstart rows 3–4 on a device

**Checkpoint**: SC-001 holds; Back never leaves the book while a layer is open.

---

## Phase 4: User Story 6 — The chapter shown is the book's own chapter (Priority: P1)

**Goal**: chapter names (bottom bar, new bookmark label, Contents current entry) come from the book itself, on the phone
AND Desktop; no demo name for a real book (FR-018, FR-019, SC-008).

**Independent Test**: quickstart row 13 — EPUB with contents: chapter 3 → bookmark → label is chapter 3's title, on
the phone and the Desktop; a book without contents → place label.

- [ ] T029 [US6] In `source/app/screens/Reader/logic/hooks/useReaderNavigation.ts` stop reading `FAKE_CHAPTERS` for
  any real format (EPUB / PDF / Markdown / TXT); keep it only for the demo surface no real book reaches
- [ ] T030 [US6] Add a helper (in `source/app/screens/Reader/logic/hooks/useReaderNavigation.ts` or a new
  `source/app/screens/Reader/logic/readerPlace.ts`) that builds core `ContentsEntry[]` per format: EPUB = flattened TOC
  in reading order, `order` = spine index of the entry's href via the existing `normalizeHrefForLocation`; PDF =
  outline entries, `order` = 0-based page; Markdown = headings, `order` = heading index; TXT = none
- [ ] T031 [US6] Wire `chapterNameFor` / `placeFor` (T008) into `source/app/screens/Reader/phone/logic/useReadingSurface.ts`
  (`place`, `activeTocId`) — EPUB current order from the current spine index, PDF from the current page, Markdown from
  the current heading index
- [ ] T032 [US6] In `source/app/screens/Reader/ReaderScreen.tsx` pass `chapterLabel = place.name ?? formatted detail`
  (core `bookmarkLabelFor`) to `useReaderAnnotations` for new bookmarks (Desktop scope exception, FR-019)
- [ ] T033 [US6] Pass the same label from `useReadingSurface.ts` to the phone's `useReaderAnnotations`; existing
  bookmarks keep their stored label and still open at their place (acceptance 4: no rewrite)
- [ ] T034 [US6] Format `PlaceDetail` with `useT()` / `useFormat()` (`reader.phone.placePageInChapter`, `placePage`,
  `placePercent`) in one helper `source/app/screens/Reader/phone/logic/formatPlace.ts`, also used for the bookmark
  label; quickstart row 13 on phone and Desktop

**Checkpoint**: SC-008 holds; Story 3's bottom bar can show real names.

---

## Phase 5: User Story 3 — Bars that stay out of the way (Priority: P2)

**Goal**: open with bars hidden; fade in / out ≤ 200 ms; auto-hide after 4 s; one-row bottom bar with place + slider +
three icon buttons; slider and toast fixes (FR-008 – FR-012, FR-017, SC-003, SC-004).

**Independent Test**: quickstart rows 1–2, 12, 14–17.

- [ ] T035 [P] [US3] Create `source/app/screens/Reader/phone/components/MobileReaderIcons.tsx`: inline SVG,
  `viewBox="0 0 24 24"`, stroke 1.8, round caps, `aria-hidden` — back, bookmark (outline / filled), contents, notes,
  appearance, previous / next, zoom in / out / fit, colour check, underline, strike, note, copy, close, delete (style of
  `PhoneNav` / `LibraryIcons`)
- [ ] T036 [US3] Open with bars hidden: `MobileReaderScreen.tsx` dispatches `open-book(bookId)` when the first page is
  shown; nothing covers the first page (FR-008, SC-003)
- [ ] T037 [US3] Rewrite the top bar in `source/app/screens/Reader/phone/components/MobileReaderBars.tsx`:
  `[Back] title (one line, ellipsis) [Bookmark]` (52 dp + safe-area top), bookmark hidden for TXT (`surface.bookmarks`
  absent) and filled when `isHere`; remove the PDF zoom controls from the top bar (FR-010, FR-013); icons from T035
  with accessible names, ≥ 44 dp, `active:` state, `focus-ring`
- [ ] T038 [US3] Rewrite the bottom bar in `MobileReaderBars.tsx` as one compact block ≤ 64 dp + `env(safe-area-inset-bottom)`
  (SC-004): line 1 = `place.name` (ellipsis) + formatted `place.detail` (tabular numbers, 12–13 px); line 2 = slider +
  Contents / Notes / Appearance icon buttons (Contents hidden when `surface.toc` is empty); landscape / 360 px keeps
  every control ≥ 44 dp
- [ ] T039 [US3] Fade both bars with `opacity` + `visibility` transitions (180 ms, none under
  `prefers-reduced-motion`), overlaying the text so the page never moves or re-lays out (FR-009); styles under
  `[data-mobile-host]` in `source/app/styles/phone.css` or the component's classes
- [ ] T040 [US3] Fix the slider (FR-011, R13) in `MobileReaderBars.tsx`: track `pointerdown` → `pointerup` /
  `pointercancel` on `window`, commit the released value once even when released outside; keys move the value and
  commit on `keyup` or 400 ms after the last key, not on every repeat; dragging dispatches `slider-drag(true/false)`
  and shows the target place in a bubble above the thumb
- [ ] T041 [US3] Toast (FR-012): `MobileReaderBars.tsx` measures the top bar (`ResizeObserver`) and calls
  `setTopInset`; the toast in `MobileReaderScreen.tsx` reads the chrome store's `toast`, sits at
  `--phone-reader-top-inset` + 8 dp (safe-area top when bars are hidden), `role="status"`, 2.4 s
- [ ] T042 [US3] Scrolling books (Markdown, TXT, EPUB Scroll, PDF Scroll): a tap anywhere not on a link / mark
  dispatches `tap-middle`; a scroll dispatches `scrolled`; remove the narrow-margin-only reveal (acceptance 5) — wire
  in `MobileReaderScreen.tsx` from the renderers' existing tap / scroll callbacks (no new format branch outside the
  surface)
- [ ] T043 [US3] Accessibility (FR-017): a visually hidden "Show reading controls" button first in the reading order
  while bars are hidden (`reader.phone.showControls`), and visually hidden Previous / Next page buttons first in the
  bottom bar's reading order in Page view (`surface.turn`)
- [ ] T044 [US3] Quickstart rows 1, 2, 12, 14, 15, 16, 17 on a device; `npm run lint` (no UI literals)

**Checkpoint**: bars hidden on open, auto-hide, one-row bottom bar; Story 3 testable on its own.

---

## Phase 6: User Story 2 — Turn pages by swiping (Priority: P1)

**Goal**: swipe page turns in EPUB and PDF Page view that follow the finger; edge taps on the page itself; PDF gets
Page / Scroll on the phone, Page by default (FR-003 – FR-007, FR-013a, FR-013b, SC-002).

**Independent Test**: quickstart D1–D4, 9–11.

- [ ] T045 [US2] **Device verify gate (R2)** before any further US2 code: a throw-away branch / flag wiring
  `classifyGesture` on EPUB frames, run quickstart D1–D3 on a real Android device (installed app, `npm run android`);
  if only finger-following fails, take the fallback (page slides in on release) and record the deviation in
  `specs/019-mobile-reader-redesign/plan.md` (D4)
- [ ] T046 [P] [US2] Create `source/app/screens/Reader/phone/logic/usePhonePageGestures.ts`: collects pointer
  `{ x, y, t }`, movement inside the first 350 ms, `selectionSeen` (via `selectionchange`), `startedOnMarkOrLink`,
  `layersOpen` (`!swipesAllowed`), `zoomEdge`, width; calls `classifyGesture` on release; `swipe-*` / `tap-prev` /
  `tap-next` → `surface.turn(...)` + `dispatch('page-turned')`; `tap-middle` → `dispatch('tap-middle')`; exposes
  `dx` for finger-following while `isSwipeCandidate`
- [ ] T047 [US2] EPUB (R3) in `source/app/components/reader/renderers/epub/EpubRenderer.tsx`: optional `swipePaging`
  prop (absent on Desktop = unchanged); when present, the existing `attachFrameListeners` pointer events feed the
  gesture hook (`toOuterPoint` coordinates), the renderer's host element OUTSIDE the iframe is translated by `dx` on
  `requestAnimationFrame` (transform only, never `scrollLeft`); commit → reset transform, `rendition.next()` /
  `prev()`, slide in from the opposite side 180 ms; cancel / first / last page → spring back; reduced motion → no
  translate, change on release (FR-007); `touch-action: pan-y pinch-zoom` on the section body; `isCenterClick` becomes
  the middle zone
- [ ] T048 [US2] Remove the edge tap strips laid over the text from `MobileReaderScreen.tsx` (FR-005): edge taps come
  only from the gesture classification on the page
- [ ] T049 [US2] PDF Page view (R4) in `source/app/components/reader/renderers/pdf/PdfRenderer.tsx`: optional
  `swipePaging` prop on `flow="paged"` with `pagesPerView={1}`; pointer events on the page row feed the gesture hook;
  the row follows the finger; commit → `goToSpread(±1)`; page opens fitted to the screen (fit-page zoom);
  `touch-action: pan-y pinch-zoom`; Desktop (no prop) unchanged
- [ ] T050 [US2] Zoomed PDF (FR-013b): at `pointerdown` report `zoomEdge = { left, right }` from the zoom viewport's
  `scrollLeft` (`ReaderZoomViewport`, native mode) to the gesture hook; a horizontal move pans unless the gesture
  STARTED at the edge in its direction; the turned-to page resets zoom to fit; Scroll view zoomed only pans
- [ ] T051 [US2] PDF view per book (R5) in `source/app/screens/Reader/phone/logic/useReadingSurface.ts`: phone PDF
  `view` from `book.prefs.viewMode` (`'paginated'` → `flow="paged"`, `pagesPerView=1`; `'scroll'` → `flow="scroll"`),
  missing → global default (`DEFAULT_GLOBAL_READING_PREFS`, `'paginated'`); `setView` saves through the existing
  session save and passes the current page as `initialPage`; Desktop keeps `pdfViewStore`
- [ ] T052 [US2] EPUB `view` / `setView` in `useReadingSurface.ts` from the same `book.prefs.viewMode` (switch keeps the
  CFI, existing re-render); `turn` defined only in Page view; Scroll views: no swipe, no edge zone (FR-006)
- [ ] T053 [US2] Wire `usePhonePageGestures` in `MobileReaderScreen.tsx`: pass `swipePaging` to EPUB / PDF renderers in
  Page view only; swipes ignored while a layer, the selection bar or the opening screen is shown (FR-004)
- [ ] T054 [US2] Quickstart D1–D3 (SC-002), 9, 10, 11, 15 on a device; Desktop regression for EPUB and PDF paged /
  scroll

**Checkpoint**: swipes turn pages in Page view; Scroll views scroll; PDF opens in Page view.

---

## Phase 7: User Story 4 — Appearance made for the phone (Priority: P2)

**Goal**: a phone Appearance sheet per format with the app theme, view and zoom; no Desktop-only items; controls ≥ 48 dp
(FR-013, FR-014, SC-005).

**Independent Test**: quickstart rows 7–8.

- [ ] T055 [US4] Create `source/app/screens/Reader/phone/components/MobileAppearanceSheet.tsx` (inside `MobileSheet`,
  layer `appearance`, covers ≤ 60 % of the height) with sections per `contracts/phone-reader-ui.md` "Appearance sheet":
  EPUB = theme, view, font size, font family, line spacing, margins; PDF = theme, view, zoom only; Markdown / TXT =
  theme, font size, font family, line spacing, margins; never keyboard hints, 1 / 2-page layout, weight / alignment;
  every control ≥ 48 dp, labels ≥ 12 px; sections chosen from `surface.format` passed in (no own format branching
  beyond what the surface exposes, e.g. `surface.appearance` capability list)
- [ ] T056 [US4] Theme row (R6): Paper = `light`, Sepia = `sepia`, Night = `dark`, System = `system` driving
  `useAppAppearanceStore.setThemeMode` (`source/app/theme/appAppearance.ts`) — the whole app switches and Settings →
  Appearance shows the same value
- [ ] T057 [US4] View row (EPUB / PDF): "Page" / "Scroll" calling `surface.setView` (T051–T052), position kept
- [ ] T058 [US4] Zoom row (PDF): − · Fit · + and the % (`reader.phone.zoom*`), reusing the existing phone zoom controls
  moved from the top bar (`useReaderZoomControls`)
- [ ] T059 [US4] Font size / family / line spacing / margins rows using the per-book reading settings the old
  `AaSettingsPanel` drove; changes apply live behind the sheet and keep the reading position (acceptance 3)
- [ ] T060 [US4] Replace `AaSettingsPanel` with `MobileAppearanceSheet` in `MobileReaderScreen.tsx` (phone only; Desktop
  keeps `AaSettingsPanel`); quickstart rows 7–8; `npm run lint`

**Checkpoint**: theme in 2 taps from the page (SC-005).

---

## Phase 8: User Story 5 — Marking in one step and a consistent look (Priority: P3)

**Goal**: the colour bar appears as soon as a selection is stable, in all four formats; TXT marks are saved on the
phone; vector icons everywhere (FR-015, FR-015a, FR-016, SC-006, SC-007).

**Independent Test**: quickstart rows 5–6, 17; check every control for vector icons.

### Tests (write first)

- [ ] T061 [P] [US5] Write `source/app/platforms/native/tests/txt-commit.test.ts` per `contracts/mobile-txt-commit.md`:
  round trip of `source/core/tests/contracts/fixtures/v1/txt-underline.json` (commit → `txt.open` returns the same
  row); refusals — bad shape → `invalid`; `text` present → `invalid`; `baseRevision !== 0` → `conflict`; book missing
  or not `txt` → `not_found`; unreadable file → `not_found` (nothing written); offsets outside the text, quote ≠ text at
  the offsets, or no `txtAnnotationRef` → `invalid` (nothing written); id of another book or not a TXT row → `invalid`;
  SQL failure → `db_failed` (nothing written); success `{ ok: true, revision: 0 }`; one bridge-log call per save

### Implementation

- [ ] T062 [US5] Add `commitTxtAnnotations(bookId, upserts, deletedIds)` to
  `source/app/platforms/native/stores/overlay-store.ts`: builds the same statements as `saveHighlight` /
  `deleteHighlight` and runs them in ONE `AsyncSqlDriver.transaction(statements)`; refuses ids belonging to another
  book or not TXT rows
- [ ] T063 [US5] Implement `txt.commit` in `source/app/platforms/native/bridge/txt.ts` (annotations only): validate the
  shape, refuse `text` (`invalid`) and `baseRevision !== 0` (`conflict`), load the book (`not_found` if missing / not
  `txt` / unreadable), decode with `decodeTxtBytes`, validate each upsert with core `parseTxtAnnotationRef`,
  `isValidTxtRange`, `quoteMatchesText`, `isConsistentTxtHighlight`, then T062; `txt.open` keeps `editable: false`,
  `revision: 0`; remove `txt.commit` from `unavailable.ts` if listed; make T061 pass (`npm run mobile:test`)
- [ ] T064 [US5] TXT on the phone in `useReadingSurface.ts`: marks, `openMark`, `activeMark` (colour / style / note /
  delete) through the existing `txtDocumentStore` save loop (`screens/Reader/logic/txtDocument/`) with `editable: false`;
  no editing, no undo / redo, no bookmark (FR-015a)
- [ ] T065 [US5] TXT selection report in `source/app/components/reader/renderers/txt/TxtRenderer.tsx`: read the
  textarea's `selectionStart / End` on `selectionchange` and report it like the other renderers (optional prop, Desktop
  unchanged)
- [ ] T066 [US5] One-step marking (R10) in `source/app/screens/Reader/phone/components/useLiveSelection.ts`: a selection
  is stable after 250 ms without `selectionchange` and no finger down; then call the renderer's
  `requestSelectionMenu` itself; expose the result as `surface.selection` (T019)
- [ ] T067 [US5] Rewrite `source/app/screens/Reader/phone/components/MobileSelectionBar.tsx` to one step: colour
  swatches (store palette, last used first), underline, strike, note, copy — icons with names; a colour marks at once and
  clears the selection; Note marks then opens the mark panel on its note field; remove the `pending` "Mark" state;
  shown ≤ 300 ms after a stable selection in EPUB, PDF (text), Markdown, TXT
- [ ] T068 [P] [US5] Icons in `MobileMarkSheet.tsx` (colour row, style, note field, Copy, Delete → confirm),
  `MobileMarksSheet.tsx`, `MobileTocSheet.tsx`, `MobileSheet.tsx` (close) from `MobileReaderIcons.tsx`; no ‹ › − + "Aa"
  glyph anywhere in `screens/Reader/phone/**` (FR-016, SC-007)
- [ ] T069 [US5] Quickstart rows 5, 6 (TXT mark → change → note → delete → reopen; text not editable), 17; Desktop
  TXT regression (edit, undo, mark)

**Checkpoint**: SC-006 / SC-007 hold; all stories done.

---

## Phase 9: Polish & cross-cutting

- [ ] T070 [P] Write `docs/implementation_plan/phone_reader.md` (map of the feature: core modules, chrome store,
  surface, gestures, phone `txt.commit`, checks) and add a short "Phone reader (spec 019)" paragraph to `CLAUDE.md`
- [ ] T071 [P] Run `npm run i18n:inventory` and remove any `i18n-pending` left by this feature (release gate green)
- [ ] T072 Run the full gate `npm run check` and `npm run check:desktop-baseline` (no Main file changed); fix anything red
- [ ] T073 Run the whole `specs/019-mobile-reader-redesign/quickstart.md` (device + Desktop regression) and record the
  results (incl. any R2 fallback) in `plan.md`

---

## Dependencies & execution order

### Phase dependencies

- **Setup (1)**: none. **Foundational (2)**: after Setup; BLOCKS every story.
- **US1 (3)**: after Phase 2. **US6 (4)**: after Phase 2. **US3 (5)**: after Phase 2; its place line uses US6's
  names (T031, T034) — without US6 it shows percentages only.
- **US2 (6)**: after Phase 2 and US3's bar / chrome wiring (T036, T042 share `MobileReaderScreen.tsx`); T045 gates the
  rest of US2.
- **US4 (7)**: after Phase 2; its View row needs T051–T052 (US2).
- **US5 (8)**: after Phase 2 and US1 (selection layer T027); T068 after T035 (icons).
- **Polish (9)**: after the stories wanted.

### Within each phase

- Core tests (T005, T007, T009) before their modules; T061 before T062–T063.
- T006 → T018; T008 → T031; T010 → T046; T012–T017 → T019 → T020 → T021.
- `MobileReaderScreen.tsx` tasks (T020, T028, T036, T041, T042, T048, T053, T060) are sequential (same file).

### Parallel opportunities

- T004 with T001–T003.
- T005, T007, T009 together; then T006, T008, T010 together (different files).
- T012, T013, T014, T015, T016 together (different files).
- T024 with T025; T035 with US3's other early tasks; T046 with T047 (after T045); T061 with T064–T065.
- US1 and US6 can be built in parallel after Phase 2.

## Parallel example: Phase 2 core

```text
Task: "Write phone-reader-chrome.test.ts in source/core/tests/app-models/"
Task: "Write reader-place.test.ts in source/core/tests/app-models/"
Task: "Write reader-gesture.test.ts in source/core/tests/app-models/"
# then
Task: "Implement phone-reader-chrome.ts"   Task: "Implement reader-place.ts"   Task: "Implement reader-gesture.ts"
```

## Parallel example: optional renderer props

```text
Task: "TxtRenderer optional editing props"   Task: "MdRenderer optional insert / hover props"
Task: "EpubRenderer optional translate props"   Task: "openHighlightById in useReaderHighlights.ts"
```

## Implementation strategy

### MVP

1. Phase 1 + Phase 2 (structure; phone behaviour unchanged).
2. Phase 3 (US1 — Back). **Stop and validate** quickstart 3–4. This alone removes the most frequent irritation.

### Incremental delivery (plan order)

US1 → US6 (correct data, also Desktop) → US3 (bars) → US2 (swipes, after the device gate) → US4 (Appearance) → US5
(one-step marking, TXT marks, icons). Each phase ends on its quickstart rows; commit + push after each finished phase.

## Notes

- [P] = different files, no dependency on an unfinished task.
- Never run E2E (`npm run e2e*`) as verification.
- No migration, no new IPC channel, no Main change — `check:desktop-baseline` must stay green.
