# Research: Collections screen redesign (spec 015)

Decisions taken while planning. Each: **Decision** · **Rationale** · **Alternatives considered**.

## R1 — Theme colours: tokens only, no new tokens

- **Decision**: Replace every fixed colour in the Collections UI with existing theme tokens:
  dialog `bg-[#0f172a]` → `bg-lib-surface-strong` on a solid `bg-lib-bg-deep` layer (the surface token is translucent);
  card hover `bg-[rgb(30_41_59/0.65)]` → `bg-lib-surface-hover`; `hover:bg-white/5|10` → `hover:bg-lib-surface-hover`;
  `text-red-400` / `hover:bg-red-500/10` → `text-lib-danger` / `hover:bg-lib-danger/10`; the five `STACK_GRADS`
  gradients removed (R5). Contrast of each pair is checked in Dark, Day, Paper and Sepia with the token values of
  `styles/theme.css` (quickstart step 1).
- **Rationale**: `--lib-surface-hover`, `--lib-danger`, `--lib-bg-deep` already exist per theme (spec 014 added
  `--lib-danger` with ≥ 4.5 : 1 on every page colour). No new token = no theme work.
- **Alternatives**: new `--lib-dialog-bg` token (unneeded: `bg-deep` + `surface-strong` composes the same result);
  `[data-theme]` overrides in CSS (spreads the fix away from the component).

## R2 — Sepia contrast (deferred from clarify)

- **Decision**: Sepia uses the same tokens; verified in the quickstart contrast table. If `--lib-faint` text on
  `--lib-surface` falls under 4.5 : 1 in Sepia, the card count / description use `text-lib-muted` instead (no token
  change).
- **Rationale**: Keeps the feature inside the Collections UI; token retuning would affect the whole app.

## R3 — One "more" menu per collection (card + page), long-press and right-click

- **Decision**: New `CollectionItemMenu` with Edit / Delete (+ "Add books" on the collection page). Desktop: popover
  placed with the existing core `placeMenu` (same as `BookItemMenu`). Phone: `phone-sheet` bottom sheet (same style as
  `PhoneBookSheet`), rows ≥ 44 px, Delete in `--lib-danger` with its label. Opened by the ⋮ button (44 × 44 on the phone,
  36 × 36 on Desktop, always visible), right-click (Desktop), and `withLongPress` (phone) on the card / row.
  The card's open button and the ⋮ button are siblings — never nested, never overlapping.
- **Rationale**: Reuses two proven patterns; one component for both entry points (card and page header) keeps Edit /
  Delete behaviour identical.
- **Alternatives**: keep two inline buttons but bigger (still two destructive-adjacent targets on a small card);
  swipe actions (gesture-only, discoverability).

## R4 — Bulk add: one new IPC channel, one transaction

- **Decision**: New channel `library:addBooksToCollection(collectionId, bookIds[])` →
  `{ ok, added: string[], skipped: string[] }`. Main validates the collection and each id, inserts the new books with
  consecutive `sort_order`s after the current max in **one** transaction and touches the collection once. Ids that are
  unknown or already in the collection go to `skipped` (not an error). `ok: false` only when the collection does not
  exist or the transaction fails (nothing is added). Mobile implements the same method in `native/bridge/library.ts` +
  `stores/library-store.ts` with the same shared statements. Limit: 2 000 ids per call (more → `ok: false`).
- **Rationale**: FR-010 "one action" and correct reporting: all-or-nothing in SQL, so the UI never claims a book was
  added when it was not. N calls to `addBookToCollection` would create N history touches and partial states.
- **Alternatives**: loop in the renderer (partial failure, N round trips, N re-sorts of the hub); reuse
  `addBookToCollection` with an array (changes a stable channel's argument type).

## R5 — Real covers on cards: derived in the renderer

- **Decision**: Pure core helper `collectionCoverSlots(bookIds, booksById, 3)` → up to three `{ bookId } | { empty }`
  slots, skipping ids no longer in the library. Rendered with the existing `BookCover` (`compact`) so books without an
  image get the Library's generated cover; empty slots are `bg-lib-chip` placeholders. Phone rows show the same three
  covers as a small overlapping stack (≈ 40 × 56 px front cover).
- **Rationale**: `CollectionSummary.bookIds` and the Library's `LibraryBook[]` (with `coverUrl`) are already loaded on
  the screen — no IPC, no new data.
- **Alternatives**: a Main-built collage image (new files, invalidation); first cover only (less recognisable).

## R6 — Undo restores the exact position: carry the sort order

- **Decision**: `library:removeBookFromCollection` additionally returns the removed row's `sortOrder`
  (`{ ok, sortOrder? }`; read before the delete). `library:addBookToCollection` gets an optional third argument
  `sortOrder` (finite integer ≥ 0) used instead of "next". Removal does not renumber, so re-inserting with the old value
  puts the book back at the same place. Undo is the toast action (`ImportToast` already supports one action, shown 6 s).
  If the collection or book is gone, `addBookToCollection` answers `ok: false` → toast "Can no longer be undone".
- **Rationale**: Backward-compatible extension of two existing channels (old callers keep working); no new state in
  SQLite.
- **Alternatives**: delay the delete until the toast closes (data loss on quit / crash, inconsistent across hosts);
  new `restoreBookToCollection` channel (one more channel for the same insert).

## R7 — Toggle in the book menu

- **Decision**: Collection rows in "Add to collection" become `role="menuitemcheckbox"` with `aria-checked`; a visible
  check icon (SVG, not "✓" text). Choosing a checked row removes the book (R6 Undo toast); unchecked adds it. Desktop
  `BookItemMenu` and phone `PhoneBookSheet` change the same way.
- **Rationale**: FR-011 + clarification Q3.

## R8 — Picker ("Add books")

- **Decision**: `AddBooksPicker` — Desktop: centred dialog (max 560 px wide, 80 vh); phone: full-screen page layer
  (`fixed inset-0`, search at the top, a fixed bottom bar with "Add (n)" above `env(safe-area-inset-bottom)` and the
  keyboard via `100dvh`). Rows: cover (BookCover compact 32 × 46), title, author, checkbox; whole row toggles. Search
  reuses core `matchesSearch` (same matching as the Library search). Order = the Library's current sort
  (`libraryBrowseStore.sort`), books already in the collection shown checked + disabled with "In collection". Selection
  kept while the search changes. Rows use `content-visibility: auto` with an intrinsic size so 1 000+ books scroll
  smoothly without a virtualisation library.
- **Rationale**: Clarification Q2; SC-006 (< 1 s search on 1 000 books is a filter over an in-memory array).
- **Alternatives**: virtualised list package (new dependency for a list that is fine with content-visibility);
  the Library screen in a "selection mode" (much larger change).

## R9 — Phone Collections list as compact rows

- **Decision**: On the Mobile host `CollectionsHub` renders `PhoneCollectionRow`s (one column): stacked covers ·
  name (2 lines) / description (1 line) / count · ⋮. Row height ≈ 72 px → ≥ 6 rows in a 360 × 640 viewport above the
  tab bar. Desktop keeps the card grid. Chosen by `isMobileHost()` inside the hub (small component, no lazy chunk).
- **Rationale**: Clarification Q5.

## R10 — Dialog focus: one small hook

- **Decision**: New `hooks/app/useDialogFocus(open, containerRef)`: on open remembers `document.activeElement`, moves
  focus to the first field / the container; traps Tab / Shift+Tab inside; on close restores focus to the remembered
  element if it is still in the document. Used by `NewCollectionDialog`, `AddBooksPicker`, the collection delete
  confirmation and the Desktop `CollectionItemMenu`. Phone Back via the existing `useBackClose`.
- **Rationale**: No focus utility exists in the app; a dependency (focus-trap) is not justified for four dialogs.

## R11 — Grid / List remembered

- **Decision**: Add `collectionView: 'grid' | 'list'` to `libraryBrowseStore` prefs (same localStorage key, sanitised on
  load, default `grid`); the existing "library" resetter therefore resets it. `useLibraryScreen`'s `useState` is removed.
- **Rationale**: Project preference (zustand stores for hook state); no new resetter line.

## R12 — Collection page grid and list a11y

- **Decision**: Grid → CSS grid `repeat(auto-fill, minmax(112px, 1fr))` (phone) / `minmax(132px, 1fr)` (Desktop) with
  covers at `aspect-[2/3]` and `w-full`. List rows: the trailing chevron button is removed (the whole row button opens
  the book; one Tab stop + ⋮); the row button gets `focus-visible:outline-2 outline-lib-accent outline-offset-2`.
  Hover lifts use `motion-safe:`. Card markup: the open button is an overlay sibling (`absolute inset-0`) so the `<h2>`
  stays outside the button.

## R13 — Deleting the open collection from elsewhere

- **Decision**: `useLibraryScreen` already returns to the hub after deleting the open collection; additionally, when
  `activeCollection` becomes undefined while `view.kind === 'collection'` (e.g. after `refreshCollections`), it calls
  `goCollections()`.

## R14 — Delivery order

- **Decision**: Increment 1 (shippable): R1, R2, R3, R10 + phone Back, FR-005 sizes. Increment 2: R4, R8 (picker) and
  R5 (covers). Increment 3: R6, R7, R11–R13 and remaining a11y. Tasks follow this order (clarification Q1).
