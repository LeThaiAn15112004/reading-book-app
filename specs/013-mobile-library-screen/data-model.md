# Data model: Mobile Library screen (spec 013)

**No migration, no new table, no new localStorage key.** Everything below is existing data or derived from it.

## LibraryBook (existing, `source/core/src/app-models/library-book.ts`)

Fields used: `id`, `title`, `author` (`'—'` when unknown), `format`, `coverUrl`, `isFavorite`, `status`
(`'not-started' | 'reading' | 'completed'`), `lastReadLocation` (display label; absent for `Started` / never read),
`lastReadAt` (ISO), `progressPercent` (0–100, clamped), `addedAt`.

## PhoneChipId (derived; subset of `LibraryBrowseFilter`)

| Chip (vi / en) | id | Rule (core `library-phone.ts`) | Order |
|---|---|---|---|
| Tất cả / All | `all` | every book | current sort |
| Gần đây / Recent | `recent` *(new id)* | `lastReadAt` present | `lastReadAt` desc, always |
| Đã lưu / Saved | `favorites` | `isFavorite` | current sort |
| Hoàn thành / Completed | `completed` | `status === 'completed'` | current sort |

- `LibraryBrowseFilter` = `'all' | 'recent' | 'reading' | 'not-started' | 'completed' | 'favorites'`.
  `LIBRARY_BROWSE_FILTERS` (desktop sidebar) does not list `recent`; `PHONE_LIBRARY_CHIPS` lists the four above.
- `toPhoneChip(filter)`: `reading` / `not-started` → `all` (desktop-only filters shown as All on the phone).
- Search (`matchesSearch`) applies after the chip; the "nothing matches" state is `visible.length === 0 && books > 0`.

## ContinueReadingEntry (derived)

`pickPhoneContinueReading(books, limit = 10)`:

- include: `status ∈ {reading, completed}` and `lastReadAt` present;
- order: `lastReadAt` desc, ties by title;
- `action(book)` = `'read-again'` when `status === 'completed' || (progressPercent ?? 0) >= 100`, else `'resume'`;
- card line 2 = `[lastReadLocation, relative(lastReadAt)]` joined by `·` (existing `formatRelativeLastRead`).

## List row progress (derived)

`listRowProgress(book)` = `progressPercent` rounded when `lastReadAt` is present **or** `progressPercent > 0`;
otherwise `undefined` (no bar).

## View preference (existing, `reading-book.library.browse-prefs.v1`)

`{ sort: LibrarySortId, layout: 'grid' | 'table' }`. Phone: `'table'` ⇔ List. Reset App Settings → `grid` +
`recently-added` (unchanged).

## Reading state — "Read again" transition (`books`)

```
before: reading_status = completed | reading, reading_state_json = { lastReadLocation: <Location JSON>, percent: p, … }
restartBook(id), ONE transaction:
  UPDATE books SET reading_status = 'reading', updated_at = now
  UPDATE books SET reading_state_json = json_patch(reading_state_json,
         { lastReadLocation: 'Started', percent: 0, updatedAt: now })
after:  status reading, no resumable location (Reader opens at the beginning), progress 0 %,
        every other reading_state key kept; notes / bookmarks / highlights untouched.
```

State machine of `reading_status` used by the sheet:

```
not-started --(open / markAsReading)--> reading --(markAsCompleted)--> completed
completed --(markAsReading "Mark as reading")--> reading         (location kept)
completed | reading --(restartBook "Read again")--> reading      (location cleared, 0 %)
```

## Banner slot

No data. Development build only: a fixed 320 × 50 placeholder; release: not rendered.
