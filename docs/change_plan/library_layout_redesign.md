# Library layout redesign — Sidebar + Continue Reading + Grid ⇄ Table (SCR-01)

Status: implemented (phase 1). Desktop app, `source/apps/reading-book-desktop`.

## 1. Goal

Remove the "horizontal rail — open a section to see everything" pattern of the old Library hub.
Every book in the current filter is now visible on the home screen, in a responsive grid (or a
table), with vertical scrolling as the only scrolling. Library view preferences (sort, layout) live
on the Library screen itself; the Settings → Library section was removed.

Before: hub = up to 4 status sections (Favorites / Recent / Completed / Not started), each a
horizontal rail capped at 7 books, plus filter chips; the section arrow opened a separate
full-page view (`shelf` / `filter` views) with a Grid/List toggle that was not remembered.

## 2. Chosen layout: A + B + D

- **A — Sidebar + grid:** `LibrarySidebar` on the left switches the status filter; the browse area
  re-renders in place (no page change, no Back button).
- **B — Continue Reading + grid:** on *All books* (without a search) a Continue Reading strip sits
  above the full list.
- **D — Grid ⇄ Table + detail panel:** the toolbar toggles a cover grid and a dense table; selecting
  a table row opens a detail panel on the right.

```
┌ Library filters ┬ Search · Add file · Import URL ─────────────────┬───────────────┐
│ All books    19 │ CONTINUE READING  [card] [card] [card]          │ (table mode,  │
│ Reading       8 │ All books · 19 books      Sort ▾   [▦][☰]        │  row selected)│
│ Not started  11 │ ┌──┬──┬──┬──┬──┬──┬──┐                         │ Resume ★ ⋮    │
│ Completed     0 │ │  │  │  │  │  │  │  │  ← grid, wraps            │ progress      │
│ Favorites     1 │ └──┴──┴──┴──┴──┴──┴──┘     or table rows         │ cover + info  │
└─────────────────┴──────────────────────────────────────────────────┴───────────────┘
```

## 3. Why not C (Group by) in this phase

Grouping by Status / Author / Genre needs dynamic sections (tens of authors), books appearing in
several genre groups, an "Unknown" bucket, and collapsible headers — a separate feature. The
sidebar already covers status browsing, so C is deferred. The browse pipeline
(`search → filter → sort` in `useLibraryBrowse`) is the place a `groupBy` step would slot in later.

## 4. Library sidebar

`components/browse/LibrarySidebar.tsx` — exactly five items, each with a live count (counts follow
the active search):

| Item | Rule (reused) |
|---|---|
| All books | every book |
| Reading | `filterByNav(books, 'reading')` — status `reading` |
| Not started | `filterByNav(books, 'to-read')` — status `not-started` |
| Completed | `filterByNav(books, 'completed')` |
| Favorites | `filterByNav(books, 'favorites')` — `isFavorite` |

Below 900px window width the sidebar collapses to icons (60px); labels move to tooltip +
`aria-label`. The active item has `aria-current="page"`.

## 5. Collections stay in the top navigation

The sidebar has **no** Collections entry. The top-nav **Collections** tab is unchanged
(`CollectionsHub`, collection detail via `ShelfDetailView`), and Cloud Sources too. When either is
open the Library sidebar is not shown; clicking **Library** returns to the hub with the last
filter. Status stub ids that may still arrive through `openNav` (`favorites`, `reading`,
`completed`, `to-read`) now open the hub with that sidebar filter (`useLibraryView` →
`onFilterNav`).

## 6. Continue Reading

- `components/continue/ContinueReading.tsx` (the component existed but was no longer rendered; it
  was rewritten from one large card into a strip).
- Books: status `reading` with a resumable last-read location, most recent `lastReadAt` first,
  max 3 (`pickContinueReadingBooks` in `logic/libraryBrowse.ts` — same rule as the SDK's
  `pickContinueReading`, which only returns one).
- Shown only on *All books* with no search. Cards wrap in a CSS grid
  (`repeat(auto-fill, minmax(260px, 1fr))`) — never a horizontal scroller.
- Each card: cover, title, author, last-read label · relative time, progress bar + %, **Resume**
  (opens the reader through the existing `openReader`), ⋮ / right-click → existing book menu.

## 7. Grid / Table

Toolbar (`LibraryBrowseToolbar`): current filter title + book count, **Sort** (Recently added ·
Recently read · Title · Author), **Grid / Table** toggle. Sort and layout are persisted in
`localStorage` (`reading-book.library.browse-prefs.v1`) — the last choice is the default. The
sidebar filter starts at *All books* each session.

Sorting (`sortLibraryBooks`): dates descending with missing values last; Title / Author use
`Intl.Collator` (accent-insensitive, numeric); books without an author (`—`) sort after authors.

**Grid** (`LibraryBookGrid`): CSS grid `repeat(auto-fill, minmax(136px, 1fr))` — columns grow with
the window (7 at 1440px, 4 at 860px), rows wrap, vertical scroll only. Cells reuse
`ShelfRailCard` (now width-flexible, 2:3 cover, progress bar for books in progress).

**Table** (`LibraryBookTable`): columns Cover · Title (+★) · Author · Format · Progress · Last read ·
Added · ⋮. Lower-priority columns hide via container queries as the area narrows (Author < `@lg`,
Progress < `@md`, Last read < `@2xl`, Added < `@3xl`); the author then shows under the title.
- Click = select (detail panel), double-click / Enter = open, ↑/↓ = move selection, Space =
  select, right-click / ⋮ = book menu.

**Detail panel** (`LibraryBookDetailPanel`, table mode only, 320px / 280px under 1100px):
Resume/Read, favorite toggle (existing `handleToggleFavorite`), ⋮ (existing `BookItemMenu` with
every other action), progress, and the metadata body shared with the Book info dialog
(`LibraryBookInfoContent`). Close with ✕ or Esc; switching filter or to Grid clears the selection.

## 8. Reused components / logic

- SDK filters `filterByNav`, `matchesSearch`, `formatRelativeLastRead`, `mapBookSummary`.
- `ShelfRailCard`, `BookCover`, `BookMenuButton`, `BookItemMenu`, `LibraryTopBar`,
  `LibraryEmptyState`, `BootErrorBanner`, all book mutations / dialogs in `useLibraryScreen`.
- `LibraryBookInfoDialog` body extracted into `LibraryBookInfoContent` (dialog + panel share it).
- `ContinueReading` (rewritten), `ShelfDetailView` / `ShelfDetailItem` / `ViewModeToggle` kept for
  collection detail.

Separation: data + mutations (`useLibraryScreen`) · pure filter/sort (`logic/libraryBrowse.ts`) ·
view state (zustand `useLibraryBrowseStore`) · derivation (`useLibraryBrowse`) · presentation
(`components/browse/*`, container `LibraryHub`). `useLibraryScreen` shrank (shelf/rail/filter
logic moved out or removed).

Data: the Library DTO now carries `progressPercent` (from the existing
`reading_state_json.percent`, only when a last-read location exists) and `LibraryBook` keeps
`addedAt`. No schema change, no new IPC channel.

## 9. Main files

Added
- `src/screens/Library/LibraryHub.tsx`
- `src/screens/Library/components/browse/{LibrarySidebar,LibraryBrowseToolbar,LibraryBookGrid,LibraryBookTable,LibraryBookDetailPanel}.tsx`
- `src/screens/Library/logic/{libraryBrowse,libraryBrowseStore,useLibraryBrowse}.ts`

Changed
- `LibraryScreen.tsx`, `logic/useLibraryScreen.ts`, `hooks/library/{libraryView,useLibraryView}.ts`
- `components/continue/ContinueReading.tsx`, `components/shelves/ShelfRailCard.tsx`,
  `components/book/LibraryBookInfoDialog.tsx`
- `electron/persistence/sqlite-library-store.ts`, `electron/ipc/{library.ipc,api-types}.ts`,
  `book-reader-sdk/src/app-models/library-book.ts` (`progressPercent`, `addedAt`)
- Settings: `logic/settingsNavStore.ts`, `components/layout/SettingsSectionIcon.tsx` — **Library
  section removed** (sort / layout live on the Library screen; Default Grouping is phase C).

Removed (rail hub only)
- `components/shelves/{LibraryShelves,ShelfSection,FilteredListView}.tsx`,
  `components/layout/LibraryFilterToolbar.tsx`, `logic/{useShelfOrder,useSectionOrder}.ts`;
  `LibraryView` kinds `shelf` / `filter`. The manual rail drag orders
  (`localStorage` keys of the removed hooks) are no longer used.

## 10. Verification

- `npm run typecheck` (`tsc --noEmit`): pass.
- ESLint on all touched Library / Settings / IPC files: no new findings (the remaining 3 errors +
  1 warning in those folders are pre-existing lines; removing `FilteredListView` dropped one old
  `any` error). Repository has no test runner, so no tests to run or update.
- `vite build`: pass.
- Manual, in the in-app browser against a production build with a stubbed `window.api` serving
  the real local library (19 books, 4 covers):
  - Filters: All 19 · Reading 8 · Not started 11 · Completed 0 (empty message) · Favorites 1;
    Continue Reading only on All books (3 cards with progress).
  - Sort: all four orders checked (e.g. Author → Behn, Zola, Andersen, Plath); persisted.
  - Grid ⇄ Table; row click opens the detail panel, ↓ moves selection + panel, Esc closes it.
  - Responsive: 1440 / 1024 / 860px — no horizontal scroll anywhere; grid 7 → 4 columns; table
    hides Author/Last read/Added at 1024px with the panel open; sidebar icons-only at 860px.
  - Top-nav Collections opens `CollectionsHub` without the sidebar; Library returns to the hub.
  - Settings sidebar: Appearance, Storage, Notifications, Keyboard Shortcuts, Privacy, Advanced,
    About (no Library).
- Not verified in the packaged Electron app.

## 11. Deferred

- Phase C: Group by Status / Author / Genre, collapsible groups.
- Column sorting by clicking table headers, column resize, multi-select / bulk actions.
- Generated-cover redesign (books without a cover still use the bright gradient placeholder).
- Continue Reading on narrow widths with the detail panel open stacks to one column (takes
  vertical space); a compact variant could follow.
