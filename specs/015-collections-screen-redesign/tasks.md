---

description: "Task list for spec 015 — Collections screen redesign"
---

# Tasks: Collections screen redesign

**Input**: Design documents from `specs/015-collections-screen-redesign/` (plan.md, spec.md, research.md,
data-model.md, contracts/collections-ipc.md, contracts/collections-ui.md, quickstart.md)

**Tests**: Included where plan.md lists them: the pure core module `app-models/collection-view.ts`, the new SQL
statement, the Mobile store / bridge (vitest), and a Desktop Main spike — written first. The shared UI has no test
runner: it is checked by `npm run check` and the manual pass in `quickstart.md`. Never run E2E (manual-only rule).

**Paths**: relative to the repository root. `@app` = `source/app`, core = `source/core`.
`Lib` = `source/app/screens/Library`, `Coll` = `source/app/screens/Library/components/collections`.

**Delivery order** (clarification Q1): Phase 3 (US1) is the first shippable increment; then US2 + US3; then US4–US6.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US6 from spec.md

---

## Phase 1: Setup

- [ ] T001 Confirm the branch is `015-collections-screen-redesign` and `.specify/feature.json` points to `specs/015-collections-screen-redesign`; leave the unrelated uncommitted files (`electron-builder.json5`, `source/scripts/check-desktop-package*.mjs`, `source/scripts/desktop-package-deps.mjs`, `source/scripts/check-packaged-runtime.mjs`, `docs/store/privacy-policy.html`, `.claude/skills/*`) unstaged in every commit of this feature

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the focus hook and the i18n keys every story uses.

- [ ] T002 [P] Create `source/app/hooks/app/useDialogFocus.ts` (research R10): `useDialogFocus(open: boolean, containerRef: RefObject<HTMLElement | null>, options?: { initialFocusRef?: RefObject<HTMLElement | null> })` — on `open` true: remember `document.activeElement`, focus `initialFocusRef` or the first focusable element in the container (else the container with `tabIndex=-1`); while open: on `keydown` Tab / Shift+Tab inside the container wrap focus between the first and last focusable elements (`a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])`, visible only); on close / unmount: restore focus to the remembered element if `document.contains(it)`. Export it from `source/app/hooks/app/index.ts`
- [ ] T003 [P] Add the new i18n keys of contracts/collections-ui.md §i18n to `source/core/src/i18n/catalogue/en/library.ts` and the same shape to `vi/library.ts` (en / vi): `collections.moreActionsAria` ("More actions for {name}" / "Thao tác khác cho {name}"), `collections.openAria` ("Open collection {name}" / "Mở bộ sưu tập {name}"), `collections.addBooks` ("Add books" / "Thêm sách"), `collections.emptyAddHint` ("Add books from your library to this collection." / "Thêm sách từ thư viện vào bộ sưu tập này."), `picker.title` ("Add books to {name}" / "Thêm sách vào {name}"), `picker.searchLabel` ("Search books" / "Tìm sách"), `picker.searchPlaceholder` ("Title or author" / "Tên sách hoặc tác giả"), `picker.selectedCount` ({ one: "{count} book selected", other: "{count} books selected" } / { one: "Đã chọn {count} sách", other: "Đã chọn {count} sách" }), `picker.add` ({ one: "Add ({count})", other: "Add ({count})" } / "Thêm ({count})"), `picker.inCollection` ("Already in this collection" / "Đã có trong bộ sưu tập"), `picker.noMatch` ("No book matches “{query}”." / "Không có sách nào khớp với “{query}”."), `picker.libraryEmpty` ("Your library has no books yet." / "Thư viện chưa có sách nào."), `picker.libraryEmptyAction` ("Import books" / "Nhập sách"), `toast.addedMany` (plural "Added {count} book(s) to {name}" / "Đã thêm {count} sách vào {name}"), `toast.addedSomeSkipped` ("Added {added}, {skipped} could not be added" / "Đã thêm {added}, {skipped} sách không thêm được"), `toast.addManyFailed` ("Could not add the books. Nothing was changed." / "Không thêm được sách. Chưa có gì thay đổi."), `toast.undo` ("Undo" / "Hoàn tác"), `toast.undoUnavailable` ("This can no longer be undone." / "Không thể hoàn tác nữa."), `toast.restored` ("Book put back in {name}" / "Đã đưa sách trở lại {name}"), `menu.inCollection` ("In this collection" / "Đang có trong bộ sưu tập"). Use plural objects `{ one, other }` with a `count` param; no "bạn" (glossary); run `npm run sdk:test` (i18n shape + glossary tests)

**Checkpoint**: `npm run typecheck` green.

---

## Phase 3: User Story 1 — Readable and safe in every theme and on the phone (P1) 🎯 MVP / increment 1

**Goal**: no fixed dark colours; Edit / Delete behind one ⋮ menu (long-press on the phone, right-click on Desktop);
dialogs keep focus and close on the phone's Back.

**Independent Test**: quickstart steps 1 and 2 (all four themes readable; 20 taps on phone rows → 0 accidental edit /
delete; right-click menu on Desktop).

- [ ] T004 [P] [US1] Rewrite colours in `Coll/NewCollectionDialog.tsx` (R1): outer panel `bg-lib-bg-deep` with an inner `bg-lib-surface-strong` layer (or one element with both via a wrapper) instead of `bg-[#0f172a]`; description text `text-lib-muted` → keep, labels `text-lib-text`; Cancel `hover:bg-lib-surface-hover`; shadow unchanged. Call `useDialogFocus(open, dialogRef, { initialFocusRef: nameRef })` (T002) and `useBackClose(open, onClose)`; remove the manual `setTimeout` focus. Keep limits `maxLength={80}` (name, required) and `maxLength={160}` (description, optional) unchanged (FR-025)
- [ ] T005 [P] [US1] Create `Coll/CollectionItemMenu.tsx` (R3, contracts/collections-ui.md): props `{ collection: CollectionSummary; point: { x: number; y: number } | null; onEdit(); onDelete(); onClose() }`. Desktop: `role="menu"` popover placed with core `placeMenu` exactly like `book/BookItemMenu.tsx` (measured, hidden until placed, closes on outside pointerdown / Escape, `useDialogFocus` to focus the first item and restore focus on close). Phone (`isMobileHost()`): `phone-sheet` bottom sheet like `book/PhoneBookSheet.tsx` (scrim, rows `min-h-11`, title = collection name), `useBackClose(true, onClose)`. Items: Edit, a separator, Delete (`text-lib-danger`, `hover:bg-lib-danger/10`, label "Delete" — never colour alone). All colours tokens
- [ ] T006 [US1] Create `Coll/CollectionCard.tsx` (Desktop card, contracts/collections-ui.md): root `role="listitem"` `relative rounded-xl border border-lib-border-soft bg-lib-surface motion-safe:hover:-translate-y-px hover:border-lib-accent-ring hover:bg-lib-surface-hover focus-within:border-lib-accent-ring`; an overlay open button `absolute inset-0 rounded-xl` with `aria-label={t('library.collections.openAria', { name })}` and `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent`; content (covers slot, `<h2>` name `line-clamp-2`, description `line-clamp-2`, count) is NOT inside the button (`pointer-events-none` on the content, the ⋮ button `relative z-10`); an always-visible ⋮ button (36 × 36, `aria-haspopup="menu"`, `aria-expanded`, `aria-label={t('library.collections.moreActionsAria', { name })}`) top-right; `onContextMenu` opens the menu at the pointer. For now the covers slot renders the existing three gradient blocks (replaced in US3). `title` attribute with the full name on the `<h2>`
- [ ] T007 [US1] Create `Coll/PhoneCollectionRow.tsx` (FR-013a): `role="listitem"`, row `min-h-[72px]` with an open button covering covers + text (`flex-1`, `aria-label` openAria), name `line-clamp-2 text-[15px]`, description `truncate text-[13px] text-lib-muted`, count `text-xs text-lib-muted`; ⋮ button `size-11` sibling on the right (never inside the open button, `ml-2`); `withLongPress` from `@app/platforms/longPress` on the row opens the menu and calls `preventDefault` so the long-press does not also open the collection. Covers slot placeholder as in T006
- [ ] T008 [US1] Update `Coll/CollectionsHub.tsx`: remove the inline Edit / Delete buttons and `hover-reveal` block and the hard-coded `STACK_GRADS` hover colours; render `CollectionCard` in the Desktop grid and, when `isMobileHost()`, a one-column `role="list"` of `PhoneCollectionRow`s (`divide-y divide-lib-border-soft`); replace props `onEditCollection` / `onDeleteCollection` by `onOpenMenu(collectionId, point | null)`; header "New collection" button `h-11` on the phone (`min-h-11` via `[data-mobile-host]` class or `isMobileHost()`), `shadow` without the fixed amber rgba (use `shadow-sm`)
- [ ] T009 [US1] Wire the menu in `Lib/logic/useLibraryScreen.ts` + `Lib/LibraryScreen.tsx`: state `collectionMenu: { collectionId: string; point: { x: number; y: number } | null } | null` with `openCollectionMenu` / `closeCollectionMenu`; render `CollectionItemMenu` when set (Edit → `openEditCollection(id)`, Delete → `setPendingCollectionDeleteId(id)`); pass `onOpenMenu` to `CollectionsHub`
- [ ] T010 [P] [US1] In `source/app/screens/Library/components/book/ConfirmBookActionDialog.tsx` (used for the collection delete confirmation): call `useDialogFocus(true, dialogRef)` and `useBackClose(true, onCancel)` if not already present; confirm button uses `bg-lib-danger` / `text-white` tokens when `tone="danger"` (check the existing prop and keep its API)
- [ ] T011 [P] [US1] In `Lib/components/shelves/ShelfDetailView.tsx` and `ViewModeToggle.tsx` replace `hover:bg-white/5` / `focus-visible:bg-white/5` with `hover:bg-lib-surface-hover` / `focus-visible:bg-lib-surface-hover`, add `focus-visible:outline-2 focus-visible:outline-lib-accent` to the Back button; ViewModeToggle buttons `size-8` on Desktop and `size-11` with `gap-2` when `isMobileHost()` (FR-005: ≥ 8 px apart); in `Lib/components/shelves/ShelfDetailItem.tsx` replace `focus-visible:outline-none` with `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent` and `hover:bg-[rgb(30_41_59/0.55)]` with `hover:bg-lib-surface-hover` (FR-001, FR-017 for increment 1)
- [ ] T012 [US1] Add phone rules to `source/app/styles/phone.css` under `@media (max-width: 899.98px)`: `:root[data-mobile-host] .phone-collections [role='listitem'] { min-height: 72px }` and ensure `.phone-sheet [role='menuitem']` keeps `min-height: 44px` (existing rule) — add the `phone-collections` class on the hub root in T008
- [ ] T013 [US1] Run `npm run typecheck && npm run lint`, Tab through the Collections list, a card's ⋮ menu, the New / Edit dialog and the delete confirmation in each theme and check that every control shows the 2 px `lib-accent` outline (FR-017), and quickstart steps 1–2 on Desktop (Dark, Day, Paper, Sepia) and on the phone; if a Sepia pair is under 4.5 : 1 (R2) switch that text from `text-lib-faint` to `text-lib-muted` in `CollectionCard.tsx` / `PhoneCollectionRow.tsx`; note the measured ratios in `specs/015-collections-screen-redesign/quickstart.md` §1

**Checkpoint**: increment 1 shippable — commit and push.

---

## Phase 4: User Story 2 — Add several books from the collection itself (P1) / increment 2

**Goal**: "Add books" on the collection page (header + empty state) opens a picker; ticked books are added in one
transaction.

**Independent Test**: quickstart step 3 (empty collection → picker → search, tick 10 → confirm → 10 books appended in
tick order, one toast; cancel adds nothing; 1 000-book search < 1 s).

### Tests first

- [ ] T014 [P] [US2] Write failing tests in `source/core/tests/app-models/collection-view.test.ts` for `pickerRows(books: readonly LibraryBook[], collectionBookIds: readonly string[], query: string): { book: LibraryBook; included: boolean }[]` — keeps input order; empty / whitespace query returns all; filters with core `matchesSearch` (title or author, same matching as the Library search); `included` true exactly for ids in `collectionBookIds`; and for `bulkAddSummary(result: { ok: boolean; added: string[]; skipped: string[] }): { kind: 'added' | 'partial' | 'failed'; added: number; skipped: number }` — `ok:false` → `failed`; `skipped.length > 0` → `partial`; else `added`; plus a timing case: 1 000 synthetic books, `pickerRows` with a 3-letter query, median of 20 runs < 50 ms (headroom under SC-006's 1 s, which also includes rendering)
- [ ] T015 [P] [US2] Add a test in `source/core/tests/db/library-statements.test.ts` that `selectNextCollectionSortOrder` + `insertCollectionBook` used n times produce consecutive orders (documents the bulk rule of contracts/collections-ipc.md)
- [ ] T016 [P] [US2] Add failing Mobile tests in `source/app/platforms/native/tests/stores.test.ts` and `bridge.test.ts` for `addBooksToCollection(collectionId, bookIds)`: appends in the given order after existing books; ids unknown / already present / duplicated in the request go to `skipped`; unknown collection → `{ ok:false, added:[], skipped:[] }`; `bookIds` empty or > 2 000 or not all strings → `ok:false`; the collection's `updated_at` changes once

### Implementation

- [ ] T017 [US2] Implement `source/core/src/app-models/collection-view.ts` (`pickerRows`, `bulkAddSummary`; pure, imports only core) and export from `source/core/src/app-models/index.ts`; make T014 pass (`cd source/core && npx vitest run tests/app-models/collection-view.test.ts`)
- [ ] T018 [US2] Desktop store: add `addBooksToCollection(collectionId: string, bookIds: string[]): { added: string[]; skipped: string[] }` to `source/app/platforms/electron/persistence/sqlite-library-store.ts` — inside ONE `this.sql.transaction` (same pattern as the store's other transactions): read existing ids (`selectCollectionBookIds`), next order (`selectNextCollectionSortOrder`), for each id in order: skip if seen / present / `findById` misses, else `insertCollectionBook(collectionId, id, order++, now)`; `touchCollection` once if any added; throws → caller returns `ok:false`
- [ ] T019 [US2] Desktop IPC (four places, contracts/collections-ipc.md): `LibraryChannels.addBooksToCollection = 'library:addBooksToCollection'` in `ipc/channels.ts`; handler in `ipc/library.ipc.ts` validating `collectionId` (non-empty string of an existing collection) and `bookIds` (array of 1–2 000 non-empty strings, trimmed) → `{ ok, added, skipped }`, catch → `{ ok:false, added:[], skipped:[] }`; `AddBooksToCollectionResultDto` + method in `ipc/api-types.ts` (`DesktopApi.library`); `preload.ts` invoke; `source/app/bridge/library.ts` wrapper
- [ ] T020 [US2] Mobile: implement the same method in `source/app/platforms/native/stores/library-store.ts` (one `this.db.transaction([...])` built after reading existing ids and the next order) and `source/app/platforms/native/bridge/library.ts` (`writes.run`, same validation as T019); make T016 pass (`npm run mobile:test`)
- [ ] T021 [US2] Add approval lines to `source/scripts/desktop-main-changes.json` for `ipc/channels.ts`, `ipc/library.ipc.ts`, `ipc/api-types.ts`, `preload.ts`, `persistence/sqlite-library-store.ts` (append "| spec 015: library:addBooksToCollection (one transaction) + add with sortOrder / remove returns sortOrder (undo position)" to existing entries, add new entries otherwise); run `npm run check:desktop-baseline`
- [ ] T022 [P] [US2] Create `source/app/platforms/electron/spikes/collections-main.mjs` + script `spike:collections:main` in the root `package.json` (same launch pattern as `spike:audio:migration`: re-launch with the app's Electron binary in `ELECTRON_RUN_AS_NODE` mode because of better-sqlite3's ABI): temp userData, migrated schema, real `SqliteLibraryStore`; cases of T016 for Desktop; a timing case: `addBooksToCollection` with 50 new books in one transaction < 200 ms (plan Performance Goals), printed with the figure; exit non-zero on failure
- [ ] T023 [US2] Add `addBooksToCollection(collectionId, bookIds)` to `source/app/hooks/library/useCollections.ts` (client method optional in `UseCollectionsOptions.client`; on result `ok` append `added` to that collection's `bookIds` in order and bump `updatedAt`; returns the raw result)
- [ ] T024 [P] [US2] Create `Lib/logic/addBooksPickerStore.ts` (zustand, data-model.md): `{ open: boolean; collectionId: string | null; query: string; selected: string[] /* tick order */; submitting: boolean; error: boolean }`, actions `openFor(collectionId)`, `close()` (resets all), `setQuery(q)`, `toggle(bookId)` (append / remove keeping order), `setSubmitting(b)`, `setError(b)`
- [ ] T025 [US2] Create `Coll/AddBooksPicker.tsx` (R8, FR-008, FR-009): props `{ books: LibraryBook[] /* already in Library sort order */; collection: CollectionSummary; onConfirm(bookIds: string[]): Promise<boolean>; onImportBooks(): void }`, reads `addBooksPickerStore`. Rows from core `pickerRows`; each row is a `<label>` with a checkbox (`aria-describedby` "Already in this collection" when included; included rows `checked disabled`), `BookCover compact` 32 × 46, title, author; whole row toggles; rows `style={{ contentVisibility: 'auto', containIntrinsicSize: '0 56px' }}`. Search `<input type="search">` with visible label (`sr-only` label + placeholder), filters as the user types. Live region (`aria-live="polite"`) with `picker.selectedCount`. Empty library → `picker.libraryEmpty` + button `picker.libraryEmptyAction` (`onImportBooks`); no match → `picker.noMatch` (selection kept). Confirm button `picker.add` disabled while `selected.length === 0 || submitting`; on `false` keep open and show `toast.addManyFailed` text above the confirm bar (`role="alert"`). Desktop: centred dialog `max-w-[560px] h-[80vh]`, header (title, close ×), scroll list, footer (Cancel, Add (n)); phone: `fixed inset-0 h-[100dvh]` page, header with back arrow + title, search under it, list, bottom bar `padding-bottom: calc(12px + env(safe-area-inset-bottom))` with full-width "Add (n)" ≥ 48 px. `useDialogFocus` (initial focus = search), Escape closes, `useBackClose(open, close)`. Token colours only
- [ ] T026 [US2] Extend `Lib/components/shelves/ShelfDetailView.tsx` with optional props `headerActions?: ReactNode` (rendered before the ViewModeToggle) and `emptyState?: ReactNode` (replaces the plain empty text when given) and `description?: string` (rendered under the title in `text-lib-muted`, full text, wraps, never clamped; the title also wraps instead of truncating, so the page always shows the full name and description — Edge Cases, FR-013)
- [ ] T027 [US2] Wire in `Lib/logic/useLibraryScreen.ts` + `Lib/LibraryScreen.tsx`: on the collection page pass `description={activeCollection.description}` (updates as soon as an edit is saved, US4 sc.2), `headerActions` = an "Add books" button (`collections.addBooks`, plus icon, `bg-lib-accent text-lib-on-accent`; Desktop `h-9` with label; phone icon-only `size-11` with `aria-label={t('library.collections.addBooks')}` so the header fits 360 px) and `emptyState` = text `shelf.emptyCollection` + `collections.emptyAddHint` + the same button; button → `addBooksPickerStore.openFor(activeCollection.id)`; render `AddBooksPicker` with the Library books in the current `libraryBrowseStore.sort` order (reuse the sorter used by `useLibraryBrowse`); `onConfirm` → `addBooksToCollection`, toast from `bulkAddSummary` (`toast.addedMany` / `toast.addedSomeSkipped` / keep open on failed), close on success; `onImportBooks` → close picker and open the existing Add-file import flow
- [ ] T028 [US2] Run `npm run sdk:test && npm run mobile:test && npm run typecheck && npm run lint && npm run spike:collections:main` and quickstart step 3 (the 1 000-book figure comes from T014's timing case; on a real device, check that typing in the picker feels instant with the largest library at hand)

---

## Phase 5: User Story 3 — Recognise collections at a glance (P2) / increment 2

**Goal**: cards and phone rows show the covers of the first three books.

**Independent Test**: quickstart step 4.

- [ ] T029 [P] [US3] Add failing tests to `source/core/tests/app-models/collection-view.test.ts` for `collectionCoverSlots(bookIds: readonly string[], hasBook: (id: string) => boolean, count = 3): ({ kind: 'book'; bookId: string } | { kind: 'empty' })[]` — always `count` slots; first `count` ids that `hasBook` accepts, in order; ids missing from the library skipped; padded with `empty`; `count` 0 → `[]`
- [ ] T030 [US3] Implement `collectionCoverSlots` in `source/core/src/app-models/collection-view.ts`; make T029 pass
- [ ] T031 [US3] Create `Coll/CollectionCovers.tsx`: props `{ slots; booksById: ReadonlyMap<string, LibraryBook>; variant: 'card' | 'stack' }`, `aria-hidden`. `card`: 3-column grid `h-[96px] gap-1.5`, each book slot `BookCover` (`bookId`, `title`, `coverUrl`, `compact`, `className="h-full w-full rounded-md object-cover"`), empty slot `rounded-md bg-lib-chip`. `stack`: three overlapping covers 40 × 56 (`-ml-5` from the 2nd, slight rotation only under `motion-safe` is NOT used — static), empty → `bg-lib-chip`
- [ ] T032 [US3] Use `CollectionCovers` in `CollectionCard.tsx` (`card`) and `PhoneCollectionRow.tsx` (`stack`), replacing the gradient placeholder; delete `STACK_GRADS` / `stackFor` from `CollectionsHub.tsx`; `CollectionsHub` gets a `books: LibraryBook[]` prop, builds `booksById` once with `useMemo` and passes `collectionCoverSlots(c.bookIds, id => booksById.has(id))`; pass `books` from `LibraryScreen.tsx`
- [ ] T033 [US3] Quickstart step 4 (0 / 1 / 2 / 3+ books, book without an image → generated cover, ≥ 6 phone rows at 360 × 640)

**Checkpoint**: increment 2 shippable — commit and push.

---

## Phase 6: User Story 4 — Manage a collection and its books from its page (P2) / increment 3

**Goal**: ⋮ on the collection page (Add books / Edit / Delete); remove with Undo at the same position; book-menu
collection rows become toggles.

**Independent Test**: quickstart step 5.

- [ ] T034 [P] [US4] Add failing Mobile tests in `source/app/platforms/native/tests/stores.test.ts` / `bridge.test.ts`: `removeBookFromCollection` returns `{ ok: true, sortOrder }` for a removed link, `{ ok: false }` otherwise; `addBookToCollection(c, b, sortOrder)` inserts with that order; remove 2nd of 4 then add with the returned order → `bookIds` identical to before; `sortOrder` not a finite integer in `0…2147483647` → `ok:false`; add after the collection was deleted → `ok:false`
- [ ] T035 [P] [US4] Add `selectCollectionBookSortOrder(collectionId, bookId)` (`SELECT sort_order AS value FROM collection_books WHERE collection_id = ? AND book_id = ?`) to `source/core/src/db/library/statements.ts` with a test in `source/core/tests/db/library-statements.test.ts`
- [ ] T036 [US4] Desktop: in `sqlite-library-store.ts` `removeBookFromCollection` reads the order then deletes + touches in one transaction and returns `{ removed: boolean; sortOrder?: number }`; `addBookToCollection(collectionId, bookId, sortOrder?)` uses the given order when present; in `ipc/library.ipc.ts` validate the optional third argument (`Number.isInteger(n) && n >= 0 && n <= 2147483647`, else `ok:false`) and return `{ ok, sortOrder }` from remove; update `api-types.ts` (`RemoveFromCollectionResultDto`), `preload.ts`, `bridge/library.ts`; extend `spike:collections:main` with the T034 cases
- [ ] T037 [US4] Mobile: same changes in `native/stores/library-store.ts` and `native/bridge/library.ts`; make T034 pass
- [ ] T038 [US4] `useCollections.ts`: `removeBookFromCollection` returns `{ ok: boolean; sortOrder?: number }`; `addBookToCollection(collectionId, bookId, sortOrder?)` inserts the id into local `bookIds` at the index matching its order (when `sortOrder` is given, re-run `refreshCollections()` after success to get the exact server order)
- [ ] T039 [US4] Undo in `Lib/logic/useLibraryScreen.ts` (FR-015): `handleRemoveFromCollection` shows `toast.removedFromCollection` with action `{ label: t('library.toast.undo'), run }` (ImportToast keeps it 6 s); `run` → `addBookToCollection(collectionId, bookId, sortOrder)` → success `toast.restored` with the collection name, failure `toast.undoUnavailable` (info). No confirmation dialog
- [ ] T040 [US4] Toggle in `Lib/components/book/BookItemMenu.tsx` and `PhoneBookSheet.tsx` (R7, FR-011): collection rows become `role="menuitemcheckbox"` with `aria-checked={included}`, never `disabled`; a check SVG icon (`aria-hidden`) for included rows replaces the `✓` text span and its `aria-label`; click on an included row → `onRemoveFromCollection(collection.id, book.id)` (the Undo toast of T039), otherwise `onAddToCollection`; add `onRemoveFromCollection` usage for any collection (not only `activeCollectionId`)
- [ ] T041 [US4] Collection page ⋮: in `LibraryScreen.tsx` add to `headerActions` a ⋮ button (`size-9` Desktop / `size-11` phone, `aria-label` moreActionsAria), header actions laid out with `gap-2` that opens `CollectionItemMenu` (Add books is the header button on both hosts, FR-007), Edit → `openEditCollection`, Delete → confirmation; after a confirmed delete of the open collection go back to the hub (existing) and, in `useLibraryScreen.ts`, also call `goCollections()` when `view.kind === 'collection'` and `activeCollection` becomes undefined (R13)
- [ ] T042 [US4] Run `npm run mobile:test && npm run spike:collections:main && npm run typecheck && npm run lint` and quickstart step 5

---

## Phase 7: User Story 5 — Keyboard and screen-reader users can do everything (P2)

**Goal**: one Tab stop per book, visible focus everywhere, states announced, Back closes layers.

**Independent Test**: quickstart step 6.

- [ ] T043 [P] [US5] `Lib/components/shelves/ShelfDetailItem.tsx`: remove the trailing chevron button and `ChevronIcon` (one Tab stop per book, FR-018); lift under `motion-safe:` only (the focus outline and hover token are already done in T011)
- [ ] T044 [P] [US5] Audit `CollectionCard.tsx`, `PhoneCollectionRow.tsx`, `CollectionItemMenu.tsx`, `AddBooksPicker.tsx`, `NewCollectionDialog.tsx`: every interactive element has a visible `focus-visible` outline (2 px `lib-accent`), icon buttons have `aria-label`, decorative SVGs `aria-hidden`; menu items support ArrowUp / ArrowDown / Home / End between items in `CollectionItemMenu` (Desktop)
- [ ] T045 [US5] Announce results without moving focus (FR-019): confirm all collection toasts go through `ImportToast` (`role="status"`, `aria-live="polite"`) and the picker's selected-count live region is polite; the Undo action button is reachable by Tab while the toast is shown
- [ ] T046 [US5] Quickstart step 6 with keyboard only, NVDA on Desktop and TalkBack on the phone; fix findings in the files above

---

## Phase 8: User Story 6 — Remembered view and fluid layout (P3)

**Goal**: Grid / List remembered and reset; even grid from 320 px; no motion when reduced.

**Independent Test**: quickstart step 7.

- [ ] T047 [US6] `Lib/logic/libraryBrowseStore.ts`: add `collectionView: 'grid' | 'list'` to `BrowsePrefs` and `DEFAULT_LIBRARY_BROWSE_PREFS` (`'grid'`), sanitise on load (anything else → `'grid'`), `setCollectionView(v)` saves; `reset()` restores it with the rest (the existing "library" resetter covers it)
- [ ] T048 [US6] `Lib/logic/useLibraryScreen.ts`: remove `useState<'grid' | 'list'>('grid')` for `collectionViewMode`; read / write `useLibraryBrowseStore` `collectionView` / `setCollectionView`
- [ ] T049 [P] [US6] `Lib/components/shelves/ShelfDetailView.tsx` grid: replace the `flex flex-wrap` + `w-[132px]` wrapper with `grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-4 sm:grid-cols-[repeat(auto-fill,minmax(132px,1fr))]` and render `ShelfRailCard` with `className="w-full min-w-0"`; ensure no horizontal scroll at 320 px
- [ ] T050 [US6] Quickstart step 7 (List kept after restart, Reset App Settings → Grid, 320 px → wide, reduced motion)

---

## Phase 9: Polish & cross-cutting

- [ ] T051 [P] Update `CLAUDE.md` (Persistence / IPC area): one paragraph "Collections (spec 015)" — `library:addBooksToCollection` (one transaction, `added` / `skipped`, ≤ 2 000 ids), `removeBookFromCollection` returns `sortOrder` and `addBookToCollection` takes an optional `sortOrder` (Undo restores the position), picker / covers in `screens/Library/components/collections/`, `collectionView` in `libraryBrowseStore`, spike `spike:collections:main`; add the spike to the spike list
- [ ] T052 [P] Search the Collections files for remaining fixed colours (`#`, `rgb(`, `white/`, `red-`, `amber`) with `rg -n "#[0-9a-fA-F]{3,6}|rgb\(|white/|red-[0-9]|rgba\(" source/app/screens/Library/components/collections source/app/screens/Library/components/shelves` and replace any left with tokens (shadows may keep `rgba(0,0,0,…)`)
- [ ] T053 Run the full gate `npm run check` and `npm run check:desktop-baseline`; fix anything red
- [ ] T054 Final quickstart pass (all 7 steps) on Desktop and the Android build; on the phone measure every target on the list, the collection page (incl. book cards' menu buttons), the dialogs and the picker: ≥ 44 × 44 px and ≥ 8 px apart (FR-005, SC-003); tick the spec checklist; commit and push

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T003)** → stories.
- **US1 (T004–T013)**: first increment, depends only on Foundational. T006/T007 before T008; T005 + T008 before T009.
- **US2 (T014–T028)**: needs US1's `CollectionItemMenu` only for the phone page menu (T041, later); otherwise independent
  of US1. Tests T014–T016 before T017–T020; T018–T020 before T023; T024–T026 before T027.
- **US3 (T029–T033)**: needs `CollectionCard` / `PhoneCollectionRow` (T006, T007). T029 → T030 → T031 → T032.
- **US4 (T034–T042)**: needs `CollectionItemMenu` (T005), `headerActions` (T026). Desktop / Mobile channel changes
  (T036, T037) share `api-types.ts` with T019 — do them after US2.
- **US5 (T043–T046)**: after US1–US4 components exist.
- **US6 (T047–T050)**: independent of US2–US5 (T049 touches `ShelfDetailView.tsx` — after T026).
- **Polish (T051–T054)**: last.

## Parallel examples

- Foundational: T002 ∥ T003.
- US1: T004 ∥ T005 ∥ T010 ∥ T011, then T006 ∥ T007.
- US2: T014 ∥ T015 ∥ T016 (tests), then T022 ∥ T024 alongside T018–T020.
- US3: T029 alongside US2's UI work (different file).
- US4: T034 ∥ T035.
- US5 / US6: T043 ∥ T044 ∥ T049.

## Implementation strategy

1. **MVP / increment 1** = Phases 1–3 (US1): the theme and phone-safety fixes. Validate (T013), commit, push.
2. **Increment 2** = US2 + US3: picker with the bulk channel, real covers. Validate (T028, T033), commit, push.
3. **Increment 3** = US4–US6 + Polish. Validate (T042, T046, T050, T053, T054), commit, push.
