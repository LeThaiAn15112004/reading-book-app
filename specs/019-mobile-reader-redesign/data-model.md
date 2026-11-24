# Data model: spec 019 — phone reader

No SQLite migration, no new table, no new IPC channel. Stored data touched: `books.reading_state_json` (existing
per-book `viewMode`, now also used for PDF on the phone) and TXT mark rows in `notes` on the phone (same shape as
Desktop). Everything else is session-only state.

## Reader chrome state (session-only, per open book) — FR-021

Held by `phoneReaderChromeStore` (app); transitions by core `reduceChrome` (pure).

| Field | Type | Rule |
|---|---|---|
| `bookId` | `string \| null` | a different id resets every other field |
| `barsVisible` | `boolean` | `false` on `open-book` (FR-008) |
| `layers` | `ChromeLayer[]` ordered, top last | `ChromeLayer = 'selection' \| 'toc' \| 'marks' \| 'appearance' \| 'mark' \| 'confirm'`; no duplicates |
| `sliderDragging` | `boolean` | pauses the idle timer |
| `toast` | `{ id: number; text: string } \| null` | replaced by the next toast; hides after 2.4 s |
| `topInsetPx` | `number` | measured top bar height, else safe-area top (FR-012) |

Events and effects (FR-008, FR-009, FR-001, FR-004):

| Event | Effect |
|---|---|
| `open-book(bookId)` | reset; `barsVisible = false` |
| `tap-middle` | if `layers` empty: toggle `barsVisible`; else close the top layer |
| `page-turned` / `scrolled` | `barsVisible = false` (layers untouched) |
| `idle-elapsed` (4 s) | `barsVisible = false` only if `layers` empty and not `sliderDragging` |
| `layer-open(l)` | push `l` (an existing `l` moves to the top) |
| `layer-close(l)` | remove `l` and every layer above it; `barsVisible` unchanged (FR-002) |
| `slider-drag(on)` | set `sliderDragging` |

Derived: `swipesAllowed = layers.length === 0` (FR-004); `idleTimerRunning = barsVisible && layers.length === 0 &&
!sliderDragging`.

## Gesture (pure, per touch) — FR-003 – FR-006, FR-013b

Core `classifyGesture(input) → GestureResult`.

| Input | Type |
|---|---|
| `view` | `'page' \| 'scroll'` |
| `start`, `end` | `{ x, y, t }` (CSS px, ms) |
| `maxMoveBeforeMs350` | `{ dx, dy }` — movement inside the first 350 ms |
| `width` | page width (px) |
| `startedOnMarkOrLink` | `boolean` |
| `selectionSeen` | `boolean` — a non-collapsed selection existed at any point of the gesture |
| `layersOpen` | `boolean` |
| `zoomEdge` | `{ left: boolean; right: boolean } \| null` — PDF Page view zoomed: edge already reached at `pointerdown` |

`GestureResult = { kind: 'swipe-next' | 'swipe-prev' | 'tap-prev' | 'tap-next' | 'tap-middle' | 'none' }`, with the
thresholds of research R2 (`SWIPE_MIN_PX = 48`, `SWIPE_RATIO = 1.5`, `SWIPE_COMMIT_SHARE = 0.25`,
`SWIPE_COMMIT_VELOCITY = 0.4`, `TAP_MAX_PX = 10`, `TAP_MAX_MS = 350`, `EDGE_SHARE = 0.2`). Rules: `view === 'scroll'`
→ only `tap-middle` or `none` (FR-006); `layersOpen` or `selectionSeen` or `startedOnMarkOrLink` → no swipe and no edge
tap; `zoomEdge` set → a swipe needs the edge of ITS direction already reached (swipe-next needs `right`), else `none`
(the browser pans).

## Place in the book — FR-010a, FR-018, FR-019

Core `reader-place.ts`.

- `ContentsEntry = { title: string; order: number }` — reading order position (EPUB spine index; PDF 0-based page;
  Markdown heading index).
- `chapterNameFor(entries, currentOrder) → string | null` — last entry with `order ≤ currentOrder`; `null` if none.
- `Place = { name: string | null; detail: PlaceDetail }`, `PlaceDetail =
  { kind: 'pageInChapter'; page; total } | { kind: 'page'; page; total } | { kind: 'percent'; value }`.

| Format / view | `name` | `detail` |
|---|---|---|
| EPUB Page | chapter name | `pageInChapter(sectionPage, sectionPageTotal)`; `percent` while total is 0 |
| EPUB Scroll | chapter name | `percent` |
| PDF (both views) | outline entry or `null` | `page(pageCurrent, pageTotal)`; `percent` never shows "page 0" |
| Markdown | current heading or `null` | `percent` |
| TXT | book title | `percent` |

Bookmark label (new bookmarks only): `name ?? formatDetail(detail)`.

## Reading surface (app, per open format) — FR-020, FR-023

See `contracts/reading-surface.md`. Not stored.

## Per-book view (stored, existing field) — FR-013, FR-013a

`books.reading_state_json.prefs.viewMode: 'paginated' | 'scroll'` — read and written through the existing session
save (`overlay:saveSessionState`). Phone: drives EPUB layout AND PDF flow (`paginated` → `flow="paged"`,
`pagesPerView=1`). Missing → global default (`'paginated'` unless the user changed it). Desktop: EPUB as today; PDF still
uses the global `pdfViewStore`.

## TXT mark (stored on the phone) — FR-015a

A `notes` row with `note_json.txtAnnotation = { startOffset, endOffset }` and the quote in `locatorExtended.text` —
identical to Desktop. Written only by the phone bridge's `txt.commit` (annotation-only, `baseRevision` 0, one
transaction). Validation: offsets inside the decoded text, quote equals the text at the offsets, row belongs to the
book and is a TXT row.
