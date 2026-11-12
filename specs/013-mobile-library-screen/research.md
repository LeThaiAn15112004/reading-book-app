# Research: Mobile Library screen (spec 013)

Every decision below was taken against the code as it stands on `011-translate-all-text-formats` (2026-11-12).

## R1 — Where the phone Library lives

- **Decision**: A phone-only Library home, `screens/Library/phone/MobileLibraryHub.tsx`, rendered by `LibraryScreen`
  instead of `LibraryHub` when `isMobileHost()`, loaded with `React.lazy` (same pattern as `ReaderRoute` →
  `MobileReaderScreen`). It uses the same `useLibraryScreen` / `useLibraryBrowse` / `useLibraryBrowseStore` and the same
  dialogs, sheet and import flow that `LibraryScreen` already renders.
- **Rationale**: Clarification Q (architecture) = shared web interface. `LibraryHub` is a desktop layout (sidebar, table +
  detail panel); restyling it with CSS alone cannot reorder header → chips → carousel → list. A separate home component
  keeps Desktop byte-for-byte unchanged (FR-026) while the logic stays single (FR-029).
- **Alternatives**: CSS-only overrides of `LibraryHub` (rejected: order and sidebar → chips need different markup);
  native React Native screen with NativeWind (rejected in clarification).

## R2 — Bottom tab bar

- **Decision**: `PhoneNav` moves from the top of `App.tsx` to the bottom on the Mobile host, gets an icon above each
  label (Library, Collections, Reading, Settings) like the mockup, and stays hidden in the Reader (unchanged rule).
  `App.tsx` renders the desktop chrome on top exactly as today; only the `else` branch moves after the content.
- **Rationale**: FR-021; the mockup puts the four tabs at the bottom. The bar is outside the scrolling area (the page is
  `h-screen flex-col` and only the content scrolls), so it is fixed without `position: fixed`.
- **Alternatives**: `position: fixed` over the content (rejected: needs padding bookkeeping for the last row, FR-024).

## R3 — Safe areas and system bars

- **Decision**: No host change. The Expo host (`routes/index.tsx`) already pads the WebView with views of
  `insets.top` / `insets.bottom` height painted in the colours the page reports through `app.setSystemBars`
  (`platforms/window-system-bars.ts` reads the page's top and bottom edge). Gesture (≈ 24 px) and three-button (≈ 44 px)
  navigation are both real `insets.bottom` values, so the layout adapts by itself. The page must only make sure its
  **bottom edge is the tab bar** so the navigation area takes the tab bar's colour (FR-028).
- **Rationale**: Re-implementing insets inside the page (`env(safe-area-inset-*)`) would double them: inside the padded
  WebView those values are 0 on Android.
- **Alternatives**: `react-native-safe-area-context` inside the page (impossible, it is web); passing insets as CSS
  variables (unnecessary).

## R4 — Colours of the mockup

- **Decision**: Use the app's theme tokens; no hard-coded `#0B1120`. The mockup is the default appearance: Night theme
  (`--lib-bg-deep` ≈ `#0f172a`) with the built-in **orange** accent (`DEFAULT_APP_APPEARANCE.accent = 'orange'`).
- **Rationale**: FR-025 (every element follows the theme, incl. Paper / Sepia and other accents); a fixed navy would
  break light themes and the system-bar colour reporting.
- **Alternatives**: phone-specific palette (rejected: two palettes to maintain, conflicts with Appearance settings).

## R5 — Filter chips

- **Decision**: Chips are a phone presentation of the existing `filter` in `libraryBrowseStore`. The type
  `LibraryBrowseFilter` gains one id, `recent`; the desktop sidebar list `LIBRARY_BROWSE_FILTERS` is unchanged. Phone
  chips: `all`, `recent`, `favorites` (label "Saved"), `completed`. `recent` = books with a `lastReadAt`, ordered by it,
  newest first, whatever the sort (FR-032). A phone session that finds a desktop-only filter (`reading`,
  `not-started`) active shows it as `all`. Filter is not persisted (today's behaviour).
- **Rationale**: One store, one filtering function; reuses `filterByNav` for favourites / completed.
- **Alternatives**: a separate phone chip store (rejected: second source of truth; violates the "no Mobile-only store
  without a reason" rule of `contracts/phone-ui.md`).

## R6 — Pure logic location and tests

- **Decision**: The new pure rules go to core `source/core/src/app-models/library-phone.ts` (chip filtering incl.
  `recent`, the Continue Reading pick for the phone, the "Resume / Read again" decision, the list-row progress rule)
  with vitest tests in `source/core/tests/app-models/library-phone.test.ts`.
- **Rationale**: The Desktop UI has no test runner; core tests run in `npm run check` and CI. The rules are
  platform-agnostic (`LibraryBook` only).

## R7 — Continue Reading on the phone

- **Decision**: `pickPhoneContinueReading(books, 10)`: books whose status is `reading` **or** `completed`, that have a
  `lastReadAt`, newest first, at most 10. Action = "Read again" when `status === 'completed'` or progress ≥ 100,
  otherwise "Resume". Desktop keeps `pickContinueReadingBooks` (3, reading only).
- **Rationale**: Spec User Story 1 sc. 3 and the mockup (a 100 % card with "Read again"); FR-006 (10).

## R8 — "Read again"

- **Decision**: New library operation **`library.restartBook(id)`** on both hosts: in ONE transaction, status →
  `reading` and `reading_state_json` patched with `{ lastReadLocation: 'Started', percent: 0, updatedAt: now }`
  (`json_patch`: per-book typography overrides, translation source and audio progress are kept). Then the renderer
  opens the book. With the `Started` label the Reader has no stored location and opens at the beginning. The statement
  pair is shared from core `db/library/statements.ts` (`restartReading`), used by `SqliteLibraryStore.restartBook`
  (Desktop) and the Mobile `library-store.ts`.
- **Rationale**: No existing call clears the location (`markAsReading` keeps a real one on purpose). The API type is
  Desktop's `Window['api']`, so the method exists on both hosts; Desktop's UI does not call it (FR-026). The Main
  change is listed in `source/scripts/desktop-main-changes.json`.
- **Open tab**: if the book is open in a Reading tab, the tab is closed before restarting so the Reader re-reads the
  state instead of showing its in-memory position (to verify in the tab implementation, `hooks/app`).
- **Alternatives**: `overlay.saveSessionState` with an empty location (rejected: its stale-write guard and location
  validation are written for the Reader, and it does not change the status); renderer-only "open at page 1" (rejected:
  the completed status and 0 % would not be stored, clarification Q1).

## R9 — Completed toggle in the sheet

- **Decision**: The sheet shows "Mark completed" (`markAsCompleted`) for a book that is not completed and "Mark as
  reading" (`markAsReading`, existing) for a completed one. Spec wording "Mark as unread" is read as this toggle: no
  "not started" reset is offered.
- **Rationale**: Both calls exist on both hosts; no new API.

## R10 — Grid / List and the stored layout

- **Decision**: No storage change. `layout` stays `'grid' | 'table'` in `reading-book.library.browse-prefs.v1` localStorage; on the
  phone `'table'` renders the new `MobileBookList` (and the toggle writes `'table'` for "List"). Reset App Settings
  already resets it. The grid reuses `LibraryBookGrid` with a phone column rule (`minmax(104px,1fr)` → ≥ 2 columns at
  360 px, FR-014).
- **Rationale**: FR-012/FR-013 with zero migration; Desktop unchanged.

## R11 — Banner slot

- **Decision**: `AdSlot` component between the scroll area and `PhoneNav`; renders `null` unless
  `import.meta.env.DEV`, where it draws the dashed 320 × 50 placeholder (58 px incl. padding). No ad SDK, no
  permission, no network.
- **Rationale**: Clarification Q3 + banner Q; release builds are built by `vite build` (`DEV === false`), so the slot
  is compiled out. `check:build-split` and a grep check guarantee no ad package.

## R12 — Empty state and "+" on the phone

- **Decision**: `MobileLibraryEmptyState` (icon, one sentence, "EPUB · PDF · TXT · Markdown", one "Import book"
  button → `handleFromDevice`). The header "+" calls the same `handleFromDevice` directly (Mobile has only "Add file").
  A chip / search with no match shows the existing "nothing matches" text plus a "Clear" action (FR-009).

## R13 — Performance (SC-005)

- **Decision**: Covers get `loading="lazy"` + `decoding="async"` on the phone (BookCover has neither today). List rows have a fixed height so 1 000 rows lay out cheaply;
  CSS `content-visibility: auto` with `contain-intrinsic-size` on rows/cards under `[data-mobile-host]`. No
  virtualisation library in this release; measure with 1 000 books in the quickstart and add windowing only if SC-005
  fails.
