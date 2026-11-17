# Contract: Collections IPC / Mobile bridge (spec 015)

Both hosts implement the same `window.api.library` methods (Desktop: Main handler + preload; Mobile:
`native/bridge/library.ts` on `stores/library-store.ts`). SQL comes from core `db/library/statements.ts`.

## Changed: `library:removeBookFromCollection`

```ts
removeBookFromCollection(collectionId: string, bookId: string): Promise<{ ok: boolean; sortOrder?: number }>
```

- Reads the link's `sort_order`, deletes it, touches the collection — one transaction.
- `ok: true` + `sortOrder` when a row was removed; `ok: false` (no `sortOrder`) otherwise. Old callers that only read
  `ok` are unaffected.

## Changed: `library:addBookToCollection`

```ts
addBookToCollection(collectionId: string, bookId: string, sortOrder?: number): Promise<{ ok: boolean }>
```

- `sortOrder` omitted → next order (unchanged behaviour). Present → must be a finite integer `0 ≤ n ≤ 2^31-1`, else
  `ok: false`; the link is inserted with that order (`INSERT OR IGNORE`).
- `ok: false` when the collection or the book does not exist (Undo after delete → "can no longer be undone").

## New: `library:addBooksToCollection`

```ts
addBooksToCollection(collectionId: string, bookIds: string[]): Promise<{
  ok: boolean
  added: string[]    // in the order given
  skipped: string[]  // unknown id, duplicate in the request, or already in the collection
}>
```

- Validation: `collectionId` non-empty string of an existing collection; `bookIds` an array of 1–2 000 strings
  (otherwise `{ ok: false, added: [], skipped: [] }`).
- One transaction: next order = current max + 1, each added id gets the next value; collection touched once.
  Failure → rollback, `ok: false`, `added: []`.
- Mobile: same rules, `writes.run` serialisation, `db.transaction([...])`.

## Four places (Desktop) + Mobile

| Place | Change |
|---|---|
| `platforms/electron/ipc/channels.ts` | `LibraryChannels.addBooksToCollection = 'library:addBooksToCollection'` |
| `platforms/electron/ipc/library.ipc.ts` | new handler; extended handlers above |
| `platforms/electron/persistence/sqlite-library-store.ts` | `addBooksToCollection`, `addBookToCollection(…, sortOrder?)`, `removeBookFromCollection` → `{ removed, sortOrder }` |
| `platforms/electron/preload.ts` + `ipc/api-types.ts` | method + types (`AddBooksToCollectionResultDto`, `RemoveFromCollectionResultDto`) |
| `bridge/library.ts` | wrappers |
| `platforms/native/bridge/library.ts` + `stores/library-store.ts` | same methods |
| `core/src/db/library/statements.ts` | `selectCollectionBookSortOrder(collectionId, bookId)` |
| `source/scripts/desktop-main-changes.json` | approval lines for the four Main files (reason: spec 015 bulk add + undo position) |

## Tests

- core `tests/db/library-statements.test.ts`: new statement.
- `platforms/native/tests/stores.test.ts` + `bridge.test.ts`: bulk add (order, skip, rollback, limit), add with
  `sortOrder`, remove returns `sortOrder`, remove → add with that order restores `bookIds` order.
- Desktop: `spike:collections:main` (new spike; real `SqliteLibraryStore` on the migrated schema, same cases).
