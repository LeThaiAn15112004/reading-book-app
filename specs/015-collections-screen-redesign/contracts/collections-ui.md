# Contract: Collections UI (spec 015)

Shared React UI, both hosts; phone differences gated by `isMobileHost()` (never a suffixed import). All colours are
theme tokens; all text from the i18n catalogue (`library` area, en + vi).

## Components

| Component | File | Notes |
|---|---|---|
| `CollectionsHub` | `screens/Library/components/collections/CollectionsHub.tsx` (EDIT) | Desktop: card grid; phone: `PhoneCollectionRow` list. Header "New collection" ≥ 44 px on the phone |
| `CollectionCard` | `…/collections/CollectionCard.tsx` (NEW) | covers (R5) · `<h2>` name (2 lines) · description (2 lines) · count · ⋮; open button is an overlay sibling; right-click → menu |
| `PhoneCollectionRow` | `…/collections/PhoneCollectionRow.tsx` (NEW) | stacked covers · name / description / count · ⋮ 44 × 44; long-press → menu |
| `CollectionCovers` | `…/collections/CollectionCovers.tsx` (NEW) | `variant: 'card' \| 'stack'`; uses `BookCover compact`; empty slot = `bg-lib-chip` |
| `CollectionItemMenu` | `…/collections/CollectionItemMenu.tsx` (NEW) | Desktop popover (`placeMenu`) / phone `phone-sheet`; items: Edit, Delete (danger) |
| `NewCollectionDialog` | `…/collections/NewCollectionDialog.tsx` (EDIT) | token colours, `useDialogFocus`, `useBackClose` |
| `AddBooksPicker` | `…/collections/AddBooksPicker.tsx` (NEW) | Desktop dialog / phone full-screen page (R8) |
| `ShelfDetailView` | `…/shelves/ShelfDetailView.tsx` (EDIT) | optional `headerActions` slot (Add books + ⋮) and `emptyState` slot; CSS-grid Grid |
| `ShelfDetailItem` | `…/shelves/ShelfDetailItem.tsx` (EDIT) | chevron removed, visible focus outline |
| `BookItemMenu` / `PhoneBookSheet` | `…/book/*.tsx` (EDIT) | `menuitemcheckbox` toggles (R7) |
| `useDialogFocus` | `hooks/app/useDialogFocus.ts` (NEW) | trap + restore (R10) |
| `addBooksPickerStore` | `screens/Library/logic/addBooksPickerStore.ts` (NEW, zustand) | picker state |

## Sizes and states

- Phone: every target ≥ 44 × 44 px, ≥ 8 px apart; ⋮ never overlaps the open area.
- Focus: `focus-visible` outline 2 px `lib-accent`, offset 2 px, on every control (≥ 3 : 1 in each theme).
- Destructive: `text-lib-danger` + label "Delete" / "Remove"; hover `bg-lib-danger/10`.
- Motion: hover lifts only under `motion-safe:`.

## Accessibility

- Hub: `role="list"` / `listitem`; card name is an `<h2>` outside the button; open button labelled
  "Open collection {name}"; ⋮ labelled "More actions for {name}", `aria-haspopup="menu"`, `aria-expanded`.
- Picker: dialog `aria-modal`, labelled by its title; each row a checkbox labelled "{title} — {author}"; included rows
  `aria-disabled` + "Already in this collection"; live region announces "{n} selected" (polite).
- Toasts: existing `role="status"` / `aria-live="polite"`; Undo is a button inside the toast.

## i18n keys (new, `library` area — en / vi)

`collections.moreActionsAria`, `collections.openAria`, `collections.addBooks`, `collections.emptyAddHint`,
`picker.title`, `picker.searchPlaceholder`, `picker.searchLabel`, `picker.selectedCount` ({count} plural),
`picker.add` ({count} plural, "Add (n)"), `picker.inCollection`, `picker.noMatch`, `picker.libraryEmpty`,
`picker.libraryEmptyAction`, `toast.addManyFailed`, `toast.addedMany` ({count} plural), `toast.addedSomeSkipped` ({added}, {skipped}),
`toast.undo`, `toast.undoUnavailable`, `toast.restored`, `menu.inCollection` (checkbox state text).
Vietnamese per `specs/012-app-ui-i18n/contracts/glossary.md` (no "bạn").
