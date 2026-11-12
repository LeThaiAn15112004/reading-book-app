# Contract: `library.restartBook` ("Read again")

Added to `DesktopApi['library']` (`source/app/platforms/electron/ipc/api-types.ts`), so the Mobile `window.api`
(typed as Desktop's) must implement it too.

```ts
restartBook(id: string): Promise<OkResult>   // { ok: boolean }
```

| | Desktop | Mobile |
|---|---|---|
| Channel | `library:restartBook` in `LibraryChannels` (`ipc/channels.ts`) | — (bridge call) |
| Handler | `ipc/library.ipc.ts`, same shape as `markAsReading`: book must exist | `platforms/native/bridge/library.ts`, inside `writes.run`, book must exist |
| Store | `SqliteLibraryStore.restartBook(bookId, now)` | `library-store.ts` `restartBook(bookId, now)` |
| SQL | core `db/library/statements.ts` `restartReading(bookId, now)` → `[updateReadingStatus(…, 'reading'), patchReadingState(…, { lastReadLocation: 'Started', percent: 0, updatedAt: now })]` in ONE transaction | same statements, `db.transaction([...])` |
| Preload / bridge | `preload.ts` + `bridge/library.ts` `restartBook` | `create-api.ts` already maps the group |
| Approval | `source/scripts/desktop-main-changes.json`: `library.ipc.ts`, `channels.ts`, `api-types.ts`, `preload.ts`, `sqlite-library-store.ts` (reason "spec 013 R8: library:restartBook") | — |

## Behaviour

- Unknown / invalid id → `{ ok: false }`, nothing written.
- Valid id → status `reading`; `reading_state_json` keys `lastReadLocation = 'Started'`, `percent = 0`,
  `updatedAt = now`; all other keys (typography overrides, `translationSourceLang`, `audioProgress`) unchanged.
- Notes, highlights, bookmarks, collections, favourite: unchanged.
- After `{ ok: true }` the Library list shows the book at 0 % and status reading; `restartBook` itself does not open the
  Reader (the caller opens it).

## Tests

- core: `tests/db/library-statements.test.ts` — statements produce the patch above; `json_patch` keeps other keys
  (in-memory SQLite driver used by existing db tests).
- Mobile: `platforms/native/tests/stores.test.ts` + `bridge.test.ts` — restart on a completed book, unknown id,
  other keys kept; contract fixture in `source/core/tests/contracts/` so both hosts answer the same.
- Desktop: no runner; covered by the shared statements + `npm run check:desktop-baseline` (approved files).
