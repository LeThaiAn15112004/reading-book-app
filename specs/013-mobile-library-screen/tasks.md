---

description: "Task list for spec 013 — Mobile Library screen"
---

# Tasks: Mobile Library screen

**Input**: Design documents from `specs/013-mobile-library-screen/` (plan.md, spec.md, research.md, data-model.md,
contracts/library-restart-book.md, contracts/phone-library-ui.md, quickstart.md)

**Tests**: Included for the pure rules and the new `restartBook` operation (plan.md phase 1 is test-first; the
Desktop UI has no runner, so UI is checked by `npm run check` + the device pass in quickstart.md). Never run E2E.

**Paths**: all relative to the repository root. `@app` = `source/app`, core = `source/core`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

**Purpose**: work on the feature branch and keep Desktop's baseline check green.

- [ ] T001 Create branch `013-mobile-library-screen` from the current `011-translate-all-text-formats` HEAD (`git switch -c 013-mobile-library-screen`) and confirm `.specify/feature.json` points to `specs/013-mobile-library-screen`
- [ ] T002 [P] Add the five Main files that will change for `library:restartBook` to `source/scripts/desktop-main-changes.json`, appending to an existing entry with ` | spec 013 R8: library:restartBook (status reading + reading_state lastReadLocation 'Started', percent 0, one transaction)` or creating it: `source/app/platforms/electron/ipc/channels.ts`, `source/app/platforms/electron/ipc/library.ipc.ts`, `source/app/platforms/electron/ipc/api-types.ts`, `source/app/platforms/electron/preload.ts`, `source/app/platforms/electron/persistence/sqlite-library-store.ts` (check the current key format first; some may already have entries)

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: pure rules in core, the extra filter id, the phone hub shell and its i18n keys. Every story builds on it.

**⚠️ CRITICAL**: no user story work before this phase is done.

- [ ] T003 [P] Write failing tests in `source/core/tests/app-models/library-phone.test.ts` for: `filterPhoneChip(books, 'all'|'recent'|'favorites'|'completed')` (recent = `lastReadAt` present, ordered `lastReadAt` desc whatever the input order; favorites = `isFavorite`; completed = `status === 'completed'`); `toPhoneChip(filter)` (`'reading'` / `'not-started'` → `'all'`); `pickPhoneContinueReading(books, 10)` ("include: `status ∈ {reading, completed}` and `lastReadAt` present; order: `lastReadAt` desc, ties by title", max 10); `continueAction(book)` (`'read-again'` when `status === 'completed' || (progressPercent ?? 0) >= 100`, else `'resume'`); `listRowProgress(book)` (rounded `progressPercent` when `lastReadAt` is present **or** `progressPercent > 0`, otherwise `undefined`)
- [ ] T004 Implement `source/core/src/app-models/library-phone.ts` (`PhoneChipId = 'all' | 'recent' | 'favorites' | 'completed'`, `PHONE_LIBRARY_CHIPS` with label keys `library.phone.chips.{all,recent,saved,completed}`, and the five functions of T003; import only `LibraryBook` / `filterByNav` from `./library-book.js`), export it from `source/core/src/app-models/index.ts`; make T003 pass (`cd source/core && npx vitest run tests/app-models/library-phone.test.ts`)
- [ ] T005 Extend `LibraryBrowseFilter` with `'recent'` in `source/app/screens/Library/logic/libraryBrowse.ts`: `filterLibraryBooks(books, 'recent')` delegates to core `filterPhoneChip`, `countLibraryFilters` and `LIBRARY_FILTER_EMPTY` get a `recent` entry (key `library.filterEmpty.recent`); do NOT add `recent` to `LIBRARY_BROWSE_FILTERS` (desktop sidebar unchanged, FR-026)
- [ ] T006 In `source/app/screens/Library/logic/useLibraryBrowse.ts` make the `recent` filter ignore the chosen sort (order from `filterPhoneChip`, FR-032) and expose `phoneContinueBooks = pickPhoneContinueReading(books, 10)` next to the existing desktop `continueBooks` (desktop value unchanged)
- [ ] T007 [P] Add the i18n keys of `contracts/phone-library-ui.md` (en + vi) to `source/core/src/i18n/catalogue/en/library.ts` and `source/core/src/i18n/catalogue/vi/library.ts`: `library.phone.chips.{all,recent,saved,completed}` (vi: Tất cả, Gần đây, Đã lưu, Hoàn thành), `library.phone.add`, `library.phone.searchPlaceholder`, `library.continue.readAgain` (Read again / Đọc lại), `library.phone.empty.{title,body,formats,import}` (formats: "EPUB · PDF · TXT · Markdown"), `library.phone.noMatch.clear`, `library.phone.layout.{grid,list}`, `library.phone.bookCount` (plural like `library.bookCount`), `library.menu.markReading`, `library.phone.adPlaceholder` ("Ad · Banner 320 × 50"), `library.filterEmpty.recent`; run the catalogue parity test (`npm run sdk:test`)
- [ ] T008 Create the shell `source/app/screens/Library/phone/MobileLibraryHub.tsx` taking the same props as `LibraryHubProps` (+ `onReadAgain: (bookId: string) => void`): a column with a non-scrolling top region (header + chips slots) and ONE vertical scroll container (`min-h-0 flex-1 overflow-y-auto overscroll-contain`) for carousel / toolbar / collection; boot error banner reused from `components/layout/BootErrorBanner`
- [ ] T009 In `source/app/screens/Library/LibraryScreen.tsx` render `MobileLibraryHub` instead of `LibraryHub` when `isMobileHost()` (import from `@app/platforms/host`), loaded with `React.lazy(() => import('./phone/MobileLibraryHub'))` inside `<Suspense fallback={null}>`; pass the same props; Desktop branch untouched
- [ ] T010 [P] Add the base phone rules to `source/app/styles/phone.css` (all under `:root[data-mobile-host]`): `.phone-hscroll` (horizontal scroll, `scroll-snap-type: x mandatory`, hidden scrollbar, `overscroll-behavior-x: contain`), `.phone-row` / `.phone-card` with `content-visibility: auto` + `contain-intrinsic-size` (row 80 px, card 120 px), and a 16 px side gutter for `.phone-library`

**Checkpoint**: `npm run typecheck` + `npm run sdk:test` green; on the phone the Library shows an empty phone shell, Desktop unchanged.

---

## Phase 3: User Story 2 — A first launch that tells me what to do (Priority: P1)

**Goal**: phone empty state with one "Import book" action, the header search + "+", and a distinct nothing-matches state.

**Independent Test**: fresh install → icon, sentence, formats, "Import book"; picking an EPUB shows it; cancelling changes nothing; "+" opens the picker directly; a search with no match shows "nothing matches" + Clear.

- [ ] T011 [P] [US2] Create `source/app/screens/Library/phone/MobileLibraryEmptyState.tsx`: icon (book, `aria-hidden`), `library.phone.empty.title`, `library.phone.empty.body`, `library.phone.empty.formats`, one primary button `library.phone.empty.import` (min 44 px, `bg-lib-accent`) calling `onFromDevice`; no drag-and-drop or URL text (FR-007, FR-008)
- [ ] T012 [P] [US2] Create `source/app/screens/Library/phone/MobileLibraryHeader.tsx`: the existing `LibrarySearchBox` (recent searches props as in `LibraryHub`) with placeholder `library.phone.searchPlaceholder`, and a 44 × 44 orange "+" button (`aria-label` `library.phone.add`) calling `onFromDevice` directly (FR-033)
- [ ] T013 [US2] Wire T011/T012 into `MobileLibraryHub.tsx`: header always shown; when `books !== null && books.length === 0` show `MobileLibraryEmptyState` (no chips, no carousel, no toolbar); when books exist but the chip + search match none, show `library.filterEmpty.noMatch` (or the chip's `LIBRARY_FILTER_EMPTY` text) with a `library.phone.noMatch.clear` button that clears the search (`onSearchChange('')`) and sets the filter to `all` (FR-009); cancel / failure handling stays the existing `handleFromDevice` toasts (FR-010)

**Checkpoint**: US2 testable on the device (quickstart step 1, header part of step 2).

---

## Phase 4: User Story 1 — Pick up the book I was reading (Priority: P1)

**Goal**: horizontal Continue Reading carousel; tap = open at saved place; completed = "Read again" that resets status and progress and opens at the beginning.

**Independent Test**: read to the middle → tap card → same place; mark completed → "Read again" → opens at the beginning, Library shows 0 %, status reading, highlights kept.

### Tests for User Story 1

- [ ] T014 [P] [US1] Extend `source/core/tests/db/library-statements.test.ts`: `restartReading(bookId, now)` returns `[updateReadingStatus(bookId, 'reading', now), patchReadingState(bookId, { lastReadLocation: 'Started', percent: 0, updatedAt: now })]`; on the in-memory driver used there, a row with `{ lastReadLocation: <Location JSON>, percent: 100, fontSize: 18, translationSourceLang: 'fr' }` and status `completed` ends as status `reading`, `lastReadLocation 'Started'`, `percent 0`, `fontSize 18`, `translationSourceLang 'fr'`
- [ ] T015 [P] [US1] Add Mobile tests in `source/app/platforms/native/tests/stores.test.ts` (store `restartBook`: completed → reading, 0 %, other keys kept, notes untouched) and `source/app/platforms/native/tests/bridge.test.ts` (`library.restartBook`: valid id → `{ ok: true }`; unknown / empty id → `{ ok: false }` and nothing written)

### Implementation for User Story 1

- [ ] T016 [US1] Add `restartReading(bookId, now)` to `source/core/src/db/library/statements.ts` (uses `STARTED_LOCATION_LABEL` from `../../persistence/session-location.js`); T014 passes
- [ ] T017 [US1] Mobile: `restartBook(bookId, now = new Date().toISOString())` in `source/app/platforms/native/stores/library-store.ts` running `this.db.transaction(q.restartReading(bookId, now))`; `restartBook: (id) => writes.run(...)` in `source/app/platforms/native/bridge/library.ts` with the same existence check as `markAsReading`; T015 passes
- [ ] T018 [US1] Desktop IPC (the four places): `restartBook: 'library:restartBook'` in `LibraryChannels` (`source/app/platforms/electron/ipc/channels.ts`); `restartBook(id: string): Promise<OkResult>` in `DesktopApi['library']` (`source/app/platforms/electron/ipc/api-types.ts`); handler in `source/app/platforms/electron/ipc/library.ipc.ts` copied from `markAsReading` (removeHandler + handle, book must exist) calling `store.restartBook(book.id)`; `SqliteLibraryStore.restartBook` in `source/app/platforms/electron/persistence/sqlite-library-store.ts` running both statements in ONE `this.sql.transaction`; expose in `source/app/platforms/electron/preload.ts`; `restartBook` in `source/app/bridge/library.ts`
- [ ] T019 [US1] Add `handleReadAgain(bookId)` to `source/app/screens/Library/logic/useLibraryScreen.ts`: close the book's open Reading tab first if one exists (look up the close function exported by `source/app/hooks/app` OpenReading; if none exists, add `closeTab(bookId)` there), then `libraryApi.restartBook(bookId)`; on `{ ok: true }` refresh the library and `openReader(bookId)`; on failure show `library.toast.actionFailed` and do not open; return it from the hook and pass it from `LibraryScreen.tsx` as `onReadAgain`
- [ ] T020 [US1] Create `source/app/screens/Library/phone/PhoneContinueCarousel.tsx`: section title `library.continue.title`, a `.phone-hscroll` `<ul>` of `.phone-card` items (width ≈ 78 % of the screen so the next card peeks, `scroll-snap-align: start`); card = `BookCover` (compact) · title (1 line, ellipsis) · author · `[lastReadLocation, formatRelativeLastRead(lastReadAt)]` joined by ` · ` · progress bar + `%` · action button (`continueAction` → `library.continue.resume` calls `onOpenBook`, `library.continue.readAgain` calls `onReadAgain`, outlined style for Read again) · `BookMenuButton`; tapping the cover follows the same action; `withLongPress` opens the sheet (FR-001–FR-005); render nothing when the list is empty
- [ ] T021 [US1] Use the carousel in `MobileLibraryHub.tsx` at the top of the scroll container with `phoneContinueBooks` (≤ 10, FR-006), shown only when the active chip is `all` and no search is active

**Checkpoint**: US1 + US2 = MVP; quickstart steps 1 and 3 pass.

---

## Phase 5: User Story 3 — Grid or list, remembered (+ filter chips) (Priority: P2)

**Goal**: chips All / Recent / Saved / Completed; toolbar "N books" · sort · Grid/List; a compact list row; grid columns that adapt.

**Independent Test**: switch to List, restart the app → List; Reset App Settings → Grid; "Recent" ignores sort; rotate → columns adapt, ≥ 2 in portrait.

- [ ] T022 [P] [US3] Create `source/app/screens/Library/phone/PhoneFilterChips.tsx`: `role="radiogroup"` `.phone-hscroll` row of `PHONE_LIBRARY_CHIPS` pill buttons (`role="radio"`, `aria-checked`, min-height 36 px with 44 px hit area via padding), active = accent border + accent text; value = `toPhoneChip(filter)`, change = `setFilter` (FR-030, FR-031)
- [ ] T023 [P] [US3] Create `source/app/screens/Library/phone/PhoneBrowseToolbar.tsx`: `library.phone.bookCount` · a native `<select>` of `LIBRARY_SORTS` (label translated) · a two-button Grid / List toggle (`aria-pressed`, labels `library.phone.layout.grid|list`) writing `setLayout('grid' | 'table')` (FR-011, FR-012)
- [ ] T024 [P] [US3] Create `source/app/screens/Library/phone/MobileBookList.tsx`: one `.phone-row` per book, fixed height 80 px: `BookCover` 48 × 64 · title (1 line) · author (1 line) · thin progress bar from `listRowProgress` drawn under the author line inside the same height (no bar when `undefined`) · format badge (`book.format.toUpperCase()`, `md` shown as `MD`) · `BookMenuButton`; tap row → `onOpenBook`; `withLongPress` → sheet (FR-011)
- [ ] T025 [US3] Wire chips, toolbar, list and grid into `MobileLibraryHub.tsx`: chips in the top region; toolbar then `layout === 'table' ? <MobileBookList/> : <LibraryBookGrid className="phone-grid"/>` in the scroll container; switching keeps sort, search, chip, collection (FR-013, FR-015); the desktop table / detail panel is never rendered
- [ ] T026 [P] [US3] Phone grid columns in `source/app/styles/phone.css`: `:root[data-mobile-host] .phone-grid { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 16px 12px }` so a 360 px screen with 16 px gutters gets ≥ 2 columns (FR-014); add an optional `className` prop to `source/app/screens/Library/components/browse/LibraryBookGrid.tsx` merged into its grid class (desktop default unchanged)
- [ ] T027 [P] [US3] Add `loading="lazy"` and `decoding="async"` to the `<img>` in `source/app/screens/Library/components/book/BookCover.tsx` (SC-005; harmless on Desktop)

**Checkpoint**: quickstart steps 2 and 4 pass.

---

## Phase 6: User Story 4 — Book actions in a bottom sheet (Priority: P2)

**Goal**: same sheet, same order from carousel, grid and list; Read again / Mark as reading; confirmed removal.

**Independent Test**: open the sheet from the three places for one book: identical actions and order; swipe down / Back closes it; Remove asks and names what is removed.

- [ ] T028 [US4] In `source/app/screens/Library/components/book/BookItemMenu.tsx`, when `phone` (existing `isMobileHost()`): header row (cover, title, author); first action = `continueAction(book)` (Resume → `onResume`, Read again → new optional prop `onReadAgain`); order exactly "Resume / Read again · Add to collection · favourite toggle · Mark completed / Mark as reading · Book details · Edit metadata · Remove from this collection (only with `activeCollectionId`) · separator · Remove from library (destructive)"; "Mark as reading" (`library.menu.markReading`) calls new optional prop `onMarkReading` for a completed book; hidden on phone: open file location, copy path, annotation import / export, delete file, remove audiobook (FR-016, FR-017, FR-020). Desktop order and items unchanged
- [ ] T029 [US4] Pass `onReadAgain={handleReadAgain}` and `onMarkReading` (new `handleMarkReading` in `useLibraryScreen.ts` → `libraryApi.markAsReading`, toast `library.toast.markedReading` — add the key en/vi) from `source/app/screens/Library/LibraryScreen.tsx`
- [ ] T030 [US4] Sheet dismissal in `BookItemMenu.tsx` (phone): swipe down on the sheet's handle area (pointer drag > 64 px or fast fling closes), tap on the backdrop, and the system Back gesture (the host's back event / `popstate` while the sheet is open) all call `onClose` without an action (FR-019); close the sheet when its book disappears from `books`
- [ ] T031 [US4] Phone removal text in `LibraryScreen.tsx`: on the Mobile host, "Remove from library" uses a message that names the book and states that highlights, notes, bookmarks, reading progress and the app's copy of the file are removed (new key `library.confirm.removePhoneBody` en/vi) (FR-018)

**Checkpoint**: quickstart step 5 passes.

---

## Phase 7: User Story 5 — Navigation that stays put, with a reserved banner slot (Priority: P3)

**Goal**: bottom tab bar with icons, fixed; dev-only 320 × 50 slot above it; last row never covered; system bars in app colours.

**Independent Test**: scroll 200 books to the end with gesture and 3-button navigation: bar fixed, last row visible, navigation area in the tab bar colour; release build has no slot, dev build shows the dashed placeholder.

- [ ] T032 [US5] In `source/app/App.tsx`, on the Mobile host (`!isFeatureAvailable('desktopChrome')`) render `<PhoneNav />` AFTER the content container instead of in the top chrome block (desktop `AppTitlebar` / `AppMenubar` branch unchanged); immersive reading still hides nothing new (PhoneNav already returns `null` in `/reader`)
- [ ] T033 [US5] Restyle `source/app/components/chrome/PhoneNav.tsx` as a bottom bar: `border-t` instead of `border-b`, background `bg-lib-bg-deep` (opaque, so the host's bottom-edge colour reading in `platforms/window-system-bars.ts` matches it), each item an icon above its label (inline SVGs: book, layers, open-book, gear; `aria-hidden`), active item in `text-lib-accent`; keep the 44 px targets and the reading badge (FR-021, FR-028)
- [ ] T034 [P] [US5] Create `source/app/screens/Library/phone/AdSlot.tsx`: `if (!import.meta.env.DEV) return null`; otherwise a centered dashed box 320 × 50 (`max-width: 100%`, 4 px vertical padding) with `library.phone.adPlaceholder`, `aria-hidden`; no network, no SDK (FR-022, FR-023)
- [ ] T035 [US5] Render `AdSlot` in `MobileLibraryHub.tsx` after the scroll container (outside it, so it never scrolls) and only on the Library hub (not in Collections / Settings / Reader); make sure the scroll container ends above it so the last row is fully visible (FR-024)
- [ ] T036 [US5] Verify the edge colours reported by `source/app/platforms/window-system-bars.ts` after the move (top edge = header background, bottom edge = tab bar); adjust which element it samples if it read the old top `PhoneNav` (FR-028)

**Checkpoint**: quickstart step 6 passes.

---

## Phase 8: Polish & cross-cutting

- [ ] T037 [P] Theme pass: grep `source/app/screens/Library/phone/` and `PhoneNav.tsx` for literal colours (`#`, `rgb(`) and replace them with `--lib-*` / Tailwind `lib-*` tokens (FR-025, R4); check Paper / Sepia and a non-orange accent
- [ ] T038 [P] Accessibility pass on the new components: every icon button has an `aria-label`, chips / toggle expose state, touch targets ≥ 44 × 44 (FR-027); remove `/* i18n-pending */` markers only where all text is now translated
- [ ] T039 [P] Docs: add a "Library (spec 013)" row to `specs/008-shared-core-architecture/contracts/phone-ui.md` (As built table) and a short "Mobile Library (spec 013)" paragraph to the Mobile app section of `CLAUDE.md` (phone hub under `screens/Library/phone/`, chips incl. `recent`, `library.restartBook`, dev-only `AdSlot`, PhoneNav at the bottom)
- [ ] T040 Run `npm run check` (typecheck, lint `--max-warnings 0`, sdk + mobile tests, boundaries, platform-adapters, builds, build-split) and `npm run check:desktop-baseline`; fix anything red
- [ ] T041 Release-bundle check from quickstart: `npm run build:web` then confirm the placeholder string is absent (`grep -c "Banner 320" source/app/platforms/native/web-dist/assets/*.js` → 0) and no ad package is imported
- [ ] T042 Device pass: run quickstart.md steps 1–8 on Android (gesture and three-button navigation, 1 000-book performance), and the Desktop regression check (SC-007); record results at the bottom of `specs/013-mobile-library-screen/quickstart.md`

---

## Dependencies & execution order

- **Setup (T001–T002)** → **Foundational (T003–T010)** → stories.
- T003 → T004 → T005 → T006 (same chain of files). T007, T010 parallel with them. T008 → T009.
- **US2 (T011–T013)** and **US1 (T014–T021)** both only need Foundational; they touch `MobileLibraryHub.tsx` in
  T013 / T021, so do those two tasks one after the other.
- US1 internal: T014 → T016; T015 → T017 (needs T016); T016 → T018; T018 + T017 → T019 → T020 → T021.
- **US3 (T022–T027)** needs Foundational; T025 after T022–T024 and T026.
- **US4 (T028–T031)** needs T019 (`handleReadAgain`) and T004 (`continueAction`).
- **US5 (T032–T036)** needs only Foundational; T035 after T034.
- **Polish (T037–T042)** after the stories that are in the release.

## Parallel examples

```text
Foundational:  T003 (core tests) | T007 (i18n) | T010 (phone.css)
US1:           T014 (core statement test) | T015 (Mobile tests)
US2:           T011 (empty state) | T012 (header)
US3:           T022 (chips) | T023 (toolbar) | T024 (list) | T026 (grid css) | T027 (cover lazy)
US5:           T034 (AdSlot) while T032/T033 move the nav
Polish:        T037 | T038 | T039
```

## Implementation strategy

1. **MVP** = Setup + Foundational + **US2 + US1** (a phone Library you can enter on day one and return to your book
   in one tap, with "Read again"). Stop, run quickstart steps 1 and 3, commit.
2. Add **US3** (chips, Grid / List) → steps 2, 4.
3. Add **US4** (sheet order) → step 5.
4. Add **US5** (bottom tab bar, slot) → step 6.
5. Polish, `npm run check`, device pass. Commit after each phase (project rule: commit + push after each finished task).
