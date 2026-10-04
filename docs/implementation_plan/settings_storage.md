# Settings → Storage (SCR-06)

Status: implemented. Part of the Settings screen described in `settings_appearance.md`.

Responsibility split: **Library** answers *which books do I have*; **Storage** answers *how much
space does Readmate Reader's data use and where is it*; **Reader settings** answer *how do I read
this book*. Storage never lists or manages individual books.

## What the app stores (`{userData}` = Electron `app.getPath('userData')`)

| Data | Location | Treated as |
|---|---|---|
| Managed book copies (URL / cloud downloads) | `{userData}/books/{uuid}/` | **Books** — never deleted by Storage |
| Referenced books (picked from the user's folders) | the user's own path | not app storage, not counted |
| Covers | `{userData}/covers/` | **Other** — not cache: covers are extracted once at import and are not regenerated |
| Library database (books, notes, sessions, collections, metadata) | `{userData}/reading-book.db` | **Other** — never deleted |
| Search index: `book_chunks` + FTS5 `book_chunks_fts` | inside `reading-book.db` | **Cache** — rebuildable |
| Chromium HTTP cache | Electron default session | **Cache** — rebuildable |
| Offline translation models | `{userData}/models/<org>/<model>` (e.g. `Xenova/opus-mt-en-vi`) | **Downloaded resource** — not cache |
| Cloud tokens, app settings | `{userData}/cloud-tokens`, Chromium storage | **Other** |

## Page layout

```
Storage
├── Book Storage        location of {userData}/books + [Open Folder]
├── Cache               used size (search index · browser cache) + [Clear Cache]
├── Translation Models  one row per downloaded model: id · size · [Remove]
└── Storage Usage       bar + Books / Cache / Translation Models / Other / Total
```

`src/screens/Settings/components/storage/StorageSettings.tsx`, state in the zustand store
`src/screens/Settings/logic/storageStore.ts`. Usage is loaded when the page opens and reloaded after
Clear Cache / Remove. Confirmations reuse `ConfirmBookActionDialog`.

### Book Storage

- Shows the managed-books folder path (display only) and **Open Folder**
  (`storage:openBooksFolder` → `shell.openPath` in Main; the renderer never sends a path).
- Explains that books added from the user's own folders stay in place and are not copied.
- **No Change Location:** managed vs referenced is derived from whether `file_path` is inside
  `{userData}/books` (`bookFileStorage`, `removeManagedBookDir`). Moving the folder would need a
  file move + `file_path` rewrite and is out of scope.

### Cache / Clear Cache

Decision: **FTS5 search index = cache → cleared by Clear Cache.**

- Size = Chromium `session.getCacheSize()` + search-index pages measured with SQLite `dbstat`
  (`book_chunks*`, its index and the FTS5 shadow tables).
- Clear Cache (after confirmation *"Clear Cache? … Your books and reading progress will not be
  deleted."*):
  1. refuses with *busy* while a book is being chunked;
  2. `DELETE FROM book_chunks` (the FTS5 rows follow through the delete trigger) + FTS5 `optimize`;
  3. `session.clearCache()`;
  4. `VACUUM` so the database file actually shrinks.
- It never deletes book files, covers, books/notes/sessions/collections rows, metadata or
  translation models.
- Rebuild: `ensureBookChunks` re-chunks a book the next time it is opened, so search and word count
  come back automatically. A book whose file is currently missing cannot be re-indexed until it is
  relinked.

### Translation Models

Decision: **translation model = downloaded resource → not part of Clear Cache.**

- Listed from `{userData}/models/<org>/<model>` with their sizes (the folders transformers.js
  writes). Empty state: *"No translation models downloaded."*
- **Remove** (after confirmation) deletes one model folder:
  - the id must match a listed `<org>/<model>` (validated segments, resolved path checked to stay
    inside `{userData}/models`);
  - refuses with *busy* while a translation is pending; otherwise the idle translation worker is
    stopped first so no loaded model keeps its files open (it respawns on the next translation);
  - the model downloads again the next time that language pair is translated.

### Storage Usage

Information only. Computed in Main by walking `{userData}` asynchronously:

- **Books** = size of `{userData}/books`
- **Cache** = browser cache + search index
- **Translation Models** = size of `{userData}/models`
- **Other** = rest of `{userData}` (database without the index, covers, settings, tokens…)
- **Total** = sum of the above

## IPC

`StorageChannels` (`electron/ipc/channels.ts`), handlers in `electron/ipc/storage.ipc.ts`, logic in
`electron/storage/storage-service.ts`, bridge `src/bridge/storage.ts`:

| Channel | Result |
|---|---|
| `storage:getUsage` | `StorageUsageDto` |
| `storage:clearCache` | `ClearCacheResult` (`busy` / `failed`) |
| `storage:removeTranslationModel` | `RemoveTranslationModelResult` (`busy` / `not_found` / `failed`) |
| `storage:openBooksFolder` | `OkResult` |

Helpers added for this: `isBookChunkingActive` / `clearBookChunkCache` (chunk service),
`getTranslationModelsDir` / `releaseTranslationWorker` (translation service).

Note: `StorageUsageDto.booksFolderPath` is the one real filesystem path sent to the renderer — for
display only; nothing in the renderer acts on it.

## Not implemented

Change Location, per-book storage breakdown, sizes of referenced books, cover cleanup.
