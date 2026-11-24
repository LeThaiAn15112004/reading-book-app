# Research: spec 019 — phone reader

Each item: **Decision**, **Rationale**, **Alternatives considered**. Items marked **verify** have a device check first,
with a fallback that still meets the spec.

## R1 — Back closes the innermost layer (FR-001, FR-002)

**Decision**: reuse the spec 014 mechanism: `hooks/app/useBackClose` + `backCloseStore` (one history entry per open
layer, `popstate` closes the top one). Every phone reader layer registers through it: selection bar, Contents,
Bookmarks / Notes, Appearance, mark panel, and a panel's own confirmation dialog. The layer order is the order in which
they opened, which is exactly the stack the store already keeps. The chrome store (R8) opens / closes layers; each
layer component calls `useBackClose(open, close)`.

**Rationale**: already proven on the phone Library / Settings (`PhoneBookSheet`, settings sections); no host change;
Desktop is a no-op (`isMobileHost()` false).

**Alternatives**: a reader-only `popstate` listener — duplicates the store and would fight it when a Library dialog
pattern is reused; handling Back in the Expo host — the host only knows `history.back()`, not the UI's layers.

## R2 — Telling a swipe from a text selection and a pan (FR-003, FR-004, FR-005) — **verify**

**Decision**: one pure classifier in core (`app-models/reader-gesture.ts`) fed by pointer events from the page:

- a gesture is a **swipe** when the finger moved ≥ 48 px horizontally, |dx| ≥ 1.5 × |dy|, the movement started within
  the first 350 ms (before Android's long-press, ~500 ms), it did not start on a mark / link, no text selection exists
  and no layer is open; it commits when released past 25 % of the page width OR with velocity ≥ 0.4 px/ms;
- a **tap** is < 10 px movement and < 350 ms; its zone is left / right edge (outer 20 % of the width, Page view only),
  middle (everything else in Page view; everywhere in Scroll view);
- anything else (long press, vertical move, selection change seen during the gesture) is **none**: the browser keeps it.

The page sets `touch-action: pan-y pinch-zoom` on the reading surface (the EPUB iframe body, the PDF Page view row) so
the WebView never claims a horizontal move itself. The edge tap zones are no longer elements over the text (FR-005):
taps are classified on the page itself, so a long press at the edge reaches the text.

**Verify** (first task of Story 2, on a real Android device, WebView of the installed app): 20 swipes / 20 edge long
presses in an EPUB and a PDF Page view (SC-002). **Fallback** if a following page cannot be told from the start of a
selection reliably: the page does not follow the finger; the swipe is still recognised on release and the page slides
in (FR-003 is then met by the settle animation only — recorded as a deviation in the plan, not silently).

**Rationale**: thresholds in one pure function are unit-testable (vitest) and shared by EPUB and PDF; the 350 ms window
is what keeps a long press (selection) from ever being read as a swipe.

**Alternatives**: the existing `components/reader/pageturn` 3D page-curl engine — a desktop demo with mouse/touch drag,
not wired to any renderer, and a curl over an epub.js iframe would need the next page rendered as an image; Hammer.js
or another gesture package — a dependency for ~80 lines, and it cannot see inside the EPUB iframe anyway.

## R3 — EPUB page that follows the finger (FR-003, FR-007)

**Decision**: epub.js (`managers/default`, paginated) shows one CSS-column page by `scrollLeft`; it is never touched
during a drag. `EpubRenderer` gets an optional `swipePaging` prop (phone only); with it, the frame listeners that
already exist (`attachFrameListeners`: pointerdown / move / up inside each section iframe) feed R2's classifier and
translate the renderer's host element (outside the iframe) by `dx` on `requestAnimationFrame`. On commit:
`rendition.next()` / `prev()`, then the host slides in from the opposite side (180 ms, `transform` only) and returns
to 0; on cancel it springs back; at the first / last page it springs back (FR-003). Reduced motion: no translate,
the page changes on release (FR-007). The existing center-click rule (`isCenterClick`) becomes the classifier's
middle zone.

**Rationale**: transforms outside the iframe cost no relayout of the book; the frame listeners already convert iframe
coordinates (`toOuterPoint`).

**Alternatives**: rendering neighbour pages for a real two-page slide — epub.js has no off-screen page API; a CSS
scroll-snap container — epub.js owns `scrollLeft` and would fight it.

## R4 — PDF Page / Scroll views on the phone (FR-013a, FR-013b)

**Decision**: reuse `PdfRenderer`'s existing `flow="paged"` (one spread at a time, `goToSpread`, Web Animations turn,
reduced-motion aware) with `pagesPerView={1}`, and add the same optional `swipePaging` prop: in Page view the pointer
events on the page row feed R2's classifier; the row follows the finger like R3, commit calls `goToSpread(±1)`.
Page view opens the page **fitted to the screen** (zoom = fit-page). Zoomed (FR-013b): at `pointerdown` the classifier
receives `atEdge = { left, right }` from the zoom viewport's `scrollLeft` (`ReaderZoomViewport`, native mode); a
horizontal move pans (the browser's scroll) unless the gesture STARTED with the edge already reached in its direction
— then it is a swipe. The turned-to page resets zoom to fit. Scroll view = today's phone PDF (`flow="scroll"`).

**Rationale**: Desktop already ships paged PDF; only the gesture is new. Deciding "edge reached" at the start of the
gesture is what makes "a swipe that reaches the edge stops there" (FR-013b) deterministic.

**Alternatives**: a phone-only PDF page view — duplicates layout, text layer and annotations; turning on edge reached
mid-gesture — rejected by the clarification (accidental turns).

## R5 — Where the Page / Scroll choice is stored (FR-013, FR-013a)

**Decision**: the phone uses the per-book reading setting `book.prefs.viewMode` (`'paginated' | 'scroll'`, saved in
`books.reading_state_json` through the existing session save) for **both** EPUB and PDF. A book with no saved value
takes the global reading default, whose built-in default is `'paginated'` (`DEFAULT_GLOBAL_READING_PREFS`), so a first
open is Page view (clarification 2026-11-25). Desktop keeps its own global `pdfViewStore` for PDF (unchanged).
Switching view keeps the position: EPUB re-renders at the current CFI (existing behaviour), PDF passes the current
page as `initialPage`.

**Rationale**: per book was decided in the clarifications; the field and its save path already exist — no migration,
no new IPC.

**Alternatives**: extending `pdfViewStore` with a per-book map in `localStorage` — a second place for per-book
settings; making Desktop PDF per book too — out of scope.

## R6 — Theme in the phone Appearance panel (FR-013)

**Decision**: the panel's theme row drives the app's single theme setting, `useAppAppearanceStore.setThemeMode`
(`light | dark | sepia | system`, the same four as Settings → Appearance), shown with the reader names the spec uses:
Paper = light, Night = dark, Sepia, and System. The whole app switches at once (`html[data-theme]`), and Settings shows
the same value.

**Rationale**: "the app's one theme setting" (Assumptions); the four modes are what that setting holds. Hiding
`system` would make a user who chose it in Settings see no selected option.

**Alternatives**: a per-book theme — rejected in the spec; only Night / Sepia / Paper — loses `system`.

## R7 — The book's own chapter name and place (FR-010a, FR-018, FR-019)

**Decision**: a pure core function `app-models/reader-place.ts`:

- `chapterNameFor(entries, current)`: `entries` = the book's contents flattened in reading order, each with
  `{ title, order }` where `order` is a comparable position (EPUB: spine index of the entry's href, via the existing
  `normalizeHrefForLocation`; PDF: outline page; Markdown: heading index). Returns the title of the LAST entry whose
  order ≤ the current position, or `null` (no contents / before the first entry).
- `placeFor(format, view, inputs)` → `{ name, detail }` per FR-010a: EPUB Page = chapter name + "page x / y in chapter"
  from `EpubNavState.sectionPage / sectionPageTotal` (percentage while `sectionPageTotal` is 0); EPUB Scroll = chapter
  name + %; PDF = outline entry (if any) + "page x / y"; Markdown = heading (if any) + %; TXT = book title + %.
- The bookmark label passed to `useReaderAnnotations` (`chapterLabel`) is `name ?? place`, on the phone AND Desktop;
  `FAKE_CHAPTERS` stops being read for real books (`useReaderNavigation` keeps it only for its demo surface, which no
  real format reaches). Existing bookmarks keep their stored label (FR-019).

**Rationale**: one rule for bar and bookmark; testable without epub.js; "spine section" is the unit epub.js paginates
by, so "page x / y in chapter" is exact there.

**Alternatives**: epub.js `navigation.get(href)` — misses entries pointing at a fragment inside a spine item; showing
the spine item's `<title>` — often the book title or a file name.

## R8 — One chrome state per open book (FR-008, FR-009, FR-012, FR-021)

**Decision**: `screens/Reader/phone/logic/phoneReaderChromeStore.ts` (zustand, session-only, reset when `bookId`
changes) holds `barsVisible`, `layers` (ordered: `selection | toc | marks | appearance | mark | confirm`), `toast`,
`sliderDragging`. Pure transitions live in core `app-models/phone-reader-chrome.ts` (`reduceChrome(state, event)`:
`open-book`, `tap-middle`, `page-turned`, `scrolled`, `idle-elapsed`, `layer-open`, `layer-close`, `slider-drag`),
so FR-008's rules are unit-tested. The 4 s idle timer runs only while bars are shown, no layer is open and the slider
is not dragged. Bars fade with `opacity` + `visibility` transitions (180 ms; none under `prefers-reduced-motion`) and
never change the text's layout (they overlay it). The toast's top is `var(--phone-reader-top-inset)`, set from the
top bar's measured height (or the safe area when hidden) (FR-012). Every bar / panel component reads this store — no
`useState` for chrome in the screen (user preference: zustand stores for custom hooks).

**Rationale**: FR-021 asks for one holder that Back, auto-hide and swipes consult; a reducer in core keeps the rules
testable.

**Alternatives**: React context — re-renders the whole reader on every change; keeping `useState` — the defect that
FR-021 names.

## R9 — One reading surface (FR-020, FR-022, FR-023)

**Decision**: `screens/Reader/phone/logic/useReadingSurface.ts` returns, for the open format, one object
`ReadingSurface` (see `contracts/reading-surface.md`): `marks` (listed rows), `markStore` (colour / style / note /
delete / close), `openMark(id)`, `jumpToMark(id)`, `selection` (`{ text, mark(kind), copy, close } | null`),
`requestSelection()`, `place` (R7), `progress`, `toc`, `goTo(item)`, `canBookmark`. Built once from the hooks the
screen already runs (`useReaderAnnotations`, `useReaderTxt`, `usePdfSelectionMenu`, Markdown state). The screen and
its sheets call only the surface.

FR-023: every format's store gets `openHighlight(id)` without a rect (the EPUB store's
`openHighlightContextMenu(info)` keeps its Desktop signature; the surface calls a new rect-less `openHighlightById`).
FR-022: props the phone does not use become optional on the shared renderers (`TxtRenderer`: `onEdit`, `onUndo`,
`onRedo`, `onSaveShortcut`, `onReplaceHover`, `caretRequest`; `MdRenderer`: `onInsertPoint`, `onAnnotationHover`,
`draftCaret`, `markupTool`; `EpubRenderer`: `translateModeActive`, `onTranslateDragEnd`, `onAnnotationDragEnd`),
treated as "absent" inside; the phone screen passes none of them and drops `NO_SHORTCUTS`. Desktop passes them as
today, so its behaviour is unchanged.

**Rationale**: SC-009 is checkable by reading the screen; the renderers' optional props are the smallest change.

**Alternatives**: a phone-only renderer set — duplicates the engine (spec 008 forbids copying logic into the phone
reader).

## R10 — One-step marking (FR-015)

**Decision**: when `useLiveSelection` reports a selection that is stable (no `selectionchange` for 250 ms and no finger
down), the surface calls the renderer's existing selection-menu request (`requestSelectionMenu`, which dispatches the
`contextmenu` the renderers already answer with the selection's geometry) itself; the bar goes straight to the colour
row (colours, underline, strike, note, copy). The intermediate "Mark" state (`pending`) disappears. TXT: the textarea
selection (`selectionStart / End`) is read by `TxtRenderer` on `selectionchange` and reported the same way.

**Rationale**: the two steps existed only because the menu request was manual; the request is cheap and idempotent.

**Alternatives**: computing the selection's geometry in the phone code — format knowledge outside the renderer.

## R11 — TXT marks on the phone (FR-015a)

**Decision**: implement `txt.commit` on the Mobile bridge (`platforms/native/bridge/txt.ts`) for annotations only:
refuse (`invalid`) any input with `text`, require `baseRevision === 0` (`conflict` otherwise: the phone never has text
revisions), re-read and decode the book's text (same `decodeTxtBytes`), validate every upsert with the core checks Main
uses (`isValidTxtRange`, `isConsistentTxtHighlight`, `quoteMatchesText`, `parseTxtAnnotationRef`), refuse ids that
belong to another book or are not TXT rows, then write upserts + deletes in ONE host transaction
(`AsyncSqlDriver.transaction(statements)`) through a new `MobileOverlayStore.commitTxtAnnotations(bookId, upserts,
deletedIds)` that builds the same statements as `saveHighlight` / `deleteHighlight`. The renderer side is the existing
`txtDocumentStore` save loop (it already batches mark changes into `txt.commit`), with `editable: false` keeping text
editing off. No migration: TXT marks are ordinary `notes` rows on the phone schema (`txt_documents` is not needed while
the revision stays 0). Contract fixtures: the Desktop `txt:commit` fixtures for annotation-only commits run against the
phone bridge (`platforms/native/tests`).

**Rationale**: the renderer store and the row format are already shared; only the phone's write path is missing.

**Alternatives**: writing TXT marks through `overlay.saveHighlight` on the phone — Desktop refuses TXT rows there; two
paths for the same rows would diverge.

## R12 — Icons and the slim bars (FR-010, FR-016, SC-004, SC-007)

**Decision**: a phone-reader icon module `screens/Reader/phone/components/MobileReaderIcons.tsx` in the app's existing
icon style (inline SVG, 24 × 24 viewBox, stroke 1.8, round caps — as `PhoneNav` / `LibraryIcons`): back, bookmark
(outline / filled), contents, notes, appearance, previous / next, zoom in / out / fit, colour check, underline, strike,
note, copy, close. Icons are `aria-hidden`; every button has an accessible name from the catalogue. Bottom bar: one
row of 56 dp (place text above the slider in one compact line + three 44 dp icon buttons) + the gesture area
(`env(safe-area-inset-bottom)`), ≤ 64 dp + system area (SC-004). Previous / next page stay reachable for screen readers
as visually hidden buttons first in the bottom bar's reading order (FR-017).

**Rationale**: one icon style already exists in the app; no icon package is added (the project ships none).

**Alternatives**: adding `@phosphor-icons/react` — a dependency for ~15 icons, and a second style next to the existing
ones.

## R13 — Slider fixes (FR-011)

**Decision**: the progress slider tracks `pointerdown` → `pointerup` / `pointercancel` on `window` (already started in
`MobileReaderBars`) and commits the released value once even when released outside; keyboard (arrow / Page keys) moves
the value and commits on `keyup` (or after 400 ms without another key), not on every repeat.

**Rationale / Alternatives**: committing on `change` — fires per key repeat; on `blur` — lost when the bar auto-hides.
