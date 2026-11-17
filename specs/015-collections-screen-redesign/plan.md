# Implementation Plan: Collections screen redesign

**Branch**: `015-collections-screen-redesign` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/015-collections-screen-redesign/spec.md`

## Summary

Rework the shared Collections UI (Desktop + phone) in three shippable increments (clarification Q1):

1. **Fixes** — every fixed dark colour replaced by theme tokens (dialog, card hover, small-button hovers, Delete in
   `--lib-danger`); Edit / Delete moved from two small hover buttons into one `CollectionItemMenu` opened by an
   always-visible ⋮ (44 px on the phone), right-click (Desktop) and long-press (phone); dialogs get focus trap + focus
   return (`useDialogFocus`) and close on the phone's Back (`useBackClose`).
2. **New capabilities** — an "Add books" picker on the collection page (Desktop dialog / phone full-screen page with a
   fixed "Add (n)" bar) backed by one new transactional channel `library:addBooksToCollection`; collection cards (and
   compact phone rows) show the covers of the first three books via `BookCover`.
3. **Polish** — Edit / Delete / Add books on the collection page; remove-with-Undo that restores the exact position
   (existing channels extended with `sortOrder`); the book menu's collection list becomes check toggles; Grid / List
   remembered in `libraryBrowseStore`; CSS-grid collection page; single Tab stop per book row; `motion-safe` lifts.

No migration. One new IPC channel, two existing channels extended backward-compatibly, on both hosts.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19 (shared UI); Electron Main (Node) for the Desktop handlers

**Primary Dependencies**: existing only — zustand, Tailwind v4 + `styles/phone.css`, `@core` (`matchesSearch`,
`placeMenu`, i18n), `better-sqlite3` (Main) / Mobile SQLite through the shared statements. No new package.

**Storage**: SQLite tables `collections` / `collection_books` unchanged (no migration); new statement
`selectCollectionBookSortOrder`. localStorage: new field `collectionView` in `reading-book.library.browse-prefs.v1`.

**Testing**: vitest — core `tests/app-models/collection-view.test.ts` (cover slots, picker rows, bulk summary),
`tests/db/library-statements.test.ts`; Mobile `platforms/native/tests/{stores,bridge}.test.ts` (bulk add, sortOrder,
undo order). Desktop Main: new spike `spike:collections:main`. `npm run check` + manual [quickstart.md](./quickstart.md).
No E2E (manual-only).

**Target Platform**: Desktop (Electron, Windows first) and Android (WebView host); same UI.

**Project Type**: Desktop app + mobile WebView host sharing one React UI.

**Performance Goals**: picker filter < 1 s on 1 000 books (in-memory `matchesSearch`; rows `content-visibility:auto`);
bulk add of 50 books in one transaction < 200 ms on Desktop; menus / sheets open < 100 ms.

**Constraints**: dependency rules R1–R12 (core helpers pure; phone branches via `isMobileHost()`); IPC four places in
sync + Mobile bridge typed by `Window['api']`; every Main file change approved in
`source/scripts/desktop-main-changes.json` (`check:desktop-baseline`); theme tokens only; i18n catalogue only
(`readmate/no-ui-literals`), Vietnamese per glossary; FR-025 (collection model, limits, delete keeps books).

**Scale/Scope**: ~7 new UI files, ~8 edited UI files, 1 new zustand store + 1 hook, 1 core module, ~20 i18n keys × 2,
4 Main files + preload/types, 2 Mobile files, 1 spike.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template; the gates are the project rules from `CLAUDE.md`.

| Gate | Status |
|---|---|
| core platform-agnostic (R1–R3): `app-models/collection-view.ts` and the new statement are pure | ✅ |
| No `.native` / `.electron` import outside `platforms/` (R12): phone UI chosen by `isMobileHost()` | ✅ |
| `window.api` only in `api.electron.ts` (R9): renderer uses `bridge/library.ts` | ✅ |
| IPC four places in sync (channels, handler, preload + `api-types`, bridge) + Mobile bridge | ✅ planned — [contracts/collections-ipc.md](./contracts/collections-ipc.md) |
| Main-file changes approved (`check:desktop-baseline`) | ✅ planned — 4 approval lines (channels, library.ipc, sqlite-library-store, preload / api-types) |
| Renderer never gets paths; DTOs plain objects | ✅ ids and numbers only |
| Hook state in zustand (project preference) | ✅ `addBooksPickerStore`, `collectionView` in `libraryBrowseStore` |
| Mobile-only store needs a written reason | ✅ n/a — no Mobile-only store |
| Reset App Settings covers new prefs | ✅ `collectionView` lives in the "library" resetter's store |
| No literal UI text; vi glossary | ✅ planned — keys in `library` area |
| Read-only / overlay invariant | ✅ n/a — no book file touched |

Post-design re-check: unchanged, all pass. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/015-collections-screen-redesign/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R14
├── data-model.md        # Phase 1: persisted / preference / session state, derived helpers
├── quickstart.md        # Phase 1: Desktop + phone validation pass
├── contracts/
│   ├── collections-ipc.md   # changed + new library channels, both hosts
│   └── collections-ui.md    # components, sizes, a11y, i18n keys
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
source/core/src/
├── app-models/collection-view.ts            # NEW: collectionCoverSlots, pickerRows, bulkAddSummary (pure)
├── db/library/statements.ts                 # EDIT: selectCollectionBookSortOrder
└── i18n/catalogue/{en,vi}/library.ts        # EDIT: picker / menu / toast keys

source/core/tests/
├── app-models/collection-view.test.ts       # NEW
└── db/library-statements.test.ts            # EDIT

source/app/
├── hooks/app/useDialogFocus.ts              # NEW: focus trap + restore
├── hooks/library/useCollections.ts          # EDIT: addBooks, add with sortOrder, remove returns sortOrder
├── bridge/library.ts                        # EDIT: addBooksToCollection, extended signatures
├── styles/phone.css                         # EDIT: picker page bottom bar safe-area, row sizes
├── screens/Library/
│   ├── LibraryScreen.tsx                    # EDIT: menu, picker, header actions, empty state wiring
│   ├── logic/useLibraryScreen.ts            # EDIT: undo toast, bulk add, toggle, collectionView, R13
│   ├── logic/libraryBrowseStore.ts          # EDIT: collectionView pref
│   ├── logic/addBooksPickerStore.ts         # NEW
│   └── components/
│       ├── collections/CollectionsHub.tsx   # EDIT
│       ├── collections/CollectionCard.tsx   # NEW
│       ├── collections/PhoneCollectionRow.tsx  # NEW
│       ├── collections/CollectionCovers.tsx # NEW
│       ├── collections/CollectionItemMenu.tsx  # NEW
│       ├── collections/AddBooksPicker.tsx   # NEW
│       ├── collections/NewCollectionDialog.tsx # EDIT
│       ├── shelves/ShelfDetailView.tsx      # EDIT
│       ├── shelves/ShelfDetailItem.tsx      # EDIT
│       ├── shelves/ViewModeToggle.tsx       # EDIT: ≥ 44 px on the phone
│       ├── book/BookItemMenu.tsx            # EDIT: menuitemcheckbox toggles
│       └── book/PhoneBookSheet.tsx          # EDIT: same
├── platforms/electron/
│   ├── ipc/channels.ts, ipc/library.ipc.ts, ipc/api-types.ts, preload.ts   # EDIT
│   ├── persistence/sqlite-library-store.ts  # EDIT
│   └── spikes/collections-main.mjs          # NEW: spike:collections:main
└── platforms/native/
    ├── bridge/library.ts                    # EDIT
    ├── stores/library-store.ts              # EDIT
    └── tests/{stores,bridge}.test.ts        # EDIT
source/scripts/desktop-main-changes.json     # EDIT: approvals
package.json                                 # EDIT: spike:collections:main script
CLAUDE.md                                    # EDIT: one paragraph (collections picker / undo / channels)
```

**Structure Decision**: Single-project layout (spec 009). Collections components stay in
`screens/Library/components/collections/`; phone variants are sibling components chosen with `isMobileHost()`
(they are small, no lazy chunk); pure derivations go to core with vitest tests.

## Complexity Tracking

No violations to justify.
