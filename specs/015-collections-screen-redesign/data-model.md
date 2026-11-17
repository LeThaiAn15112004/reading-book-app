# Data Model: Collections screen redesign (spec 015)

No migration, no new table, no new column. The SQLite tables `collections` and `collection_books`
(`collection_id`, `book_id`, `sort_order`, `added_at`) are unchanged.

## Persisted (unchanged shape)

### Collection (`CollectionSummary`, core `app-models/collection-summary.ts`)

| Field | Type | Rules |
|---|---|---|
| `id` | string | uuid |
| `name` | string | trimmed, 1–80 chars (unchanged) |
| `description` | string? | trimmed, ≤ 160 chars (unchanged) |
| `bookIds` | string[] | display order = `sort_order ASC, added_at ASC` |
| `createdAt` / `updatedAt` | ISO string | hub order = `updatedAt DESC` (unchanged) |

### Collection link (`collection_books` row)

- New behaviour only: an insert may carry an explicit `sort_order` (Undo, R6); a bulk insert assigns
  `max + 1 … max + n` in the order given (R4). `INSERT OR IGNORE` keeps a book at most once per collection.

## Device preference

### `libraryBrowseStore` prefs (localStorage `reading-book.library.browse-prefs.v1`)

| Field | Type | Default | Notes |
|---|---|---|---|
| `sort` | `LibrarySortId` | `recently-added` | unchanged |
| `layout` | `'grid' \| 'table'` | `grid` | unchanged |
| `collectionView` | `'grid' \| 'list'` | `grid` | **new**; invalid / missing → default; reset by the existing "library" resetter |

## Session-only UI state (not persisted)

| State | Owner | Lifetime |
|---|---|---|
| Open collection menu `{ collectionId, point \| 'sheet' }` | `useLibraryScreen` (or a small zustand store if shared by hub + page) | until closed |
| Picker `{ open, collectionId, query, selected: string[] (tick order) , submitting }` | `addBooksPickerStore` (zustand) | cleared on close / collection change |
| Pending undo `{ collectionId, bookId, sortOrder }` | closure of the toast action | toast lifetime (6 s) |

## Derived (pure, core)

- `collectionCoverSlots(bookIds, booksById, count = 3) → CoverSlot[]` where
  `CoverSlot = { kind: 'book'; bookId: string } | { kind: 'empty' }` — first `count` ids that still exist in the
  library, padded with `empty`.
- `pickerRows(books, collectionBookIds, query) → { book, included: boolean }[]` — `matchesSearch` filter over the
  Library-sorted books; `included` = already in the collection.
- `bulkAddSummary(requested, result) → { added: number; skipped: number; failed: boolean }` for the toast text.

## State transitions

- **Book in collection**: `absent → present` (add / bulk add / undo) · `present → absent` (remove from page / toggle in
  book menu). Undo is only offered for `present → absent`.
- **Picker**: `closed → open(empty selection) → selecting → submitting → closed` (success or failure; on `ok: false`
  stays open with the error shown above the bottom bar / footer and the selection kept).
