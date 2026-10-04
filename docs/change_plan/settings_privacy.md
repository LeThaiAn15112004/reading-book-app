# Settings → Privacy + Library search history (SCR-06 / SCR-01)

Status: implemented. Principle: **Privacy manages history Readmate Reader creates about your use;
Storage manages data, files and cache.** Book data is never touched from Privacy.

## What was checked first

Before building anything, the codebase was inspected for each proposed history type:

| Proposed item | Found in code | Decision |
|---|---|---|
| Reading History | No history/events table. Each book only has its *current* state in `books.reading_state_json` (`lastReadLocation`, `percent`, `updatedAt`) + `reading_status` — that is reading progress. `updatedAt` is also the stale-write guard of `saveSessionState`. | **Not offered.** Stopping or clearing it would break reading progress / Resume. |
| Search History | Nothing saved (Library search, titlebar search and in-book search keep no queries; only the search panel's position/size). The FTS5 index is cache (Storage). | **Built** as a real feature for the Library search box. |
| Recently Opened Books | Open reader tabs are in-memory only. "Recent" UI (Continue Reading, Recently read sort, Last read column) is derived from reading progress (`updatedAt` / `lastReadLocation`). | **Not offered.** No separate store; clearing it would mean clearing progress. |

Reading History and Recently Opened can come back with a real feature (e.g. a `reading_events`
log for reading stats) that stores them separately from progress.

## Library search history

`src/hooks/library/searchHistoryStore.ts` — zustand store persisted to `localStorage`
(`reading-book.library.search-history.v1`): `{ enabled, entries }`.

- Keeps the 8 most recent queries, newest first; case-insensitive de-duplication (a repeated query
  moves to the top); whitespace collapsed; queries shorter than 2 characters are ignored.
- A query is recorded when a search is *finished*, not on every keystroke: Enter, leaving the
  search box with a non-empty query, or picking a recent search.
- While disabled nothing is recorded and no suggestions are shown; existing entries are kept.

`src/screens/Library/components/layout/LibrarySearchBox.tsx` (used by `LibraryTopBar`, wired in
`LibraryHub`):
- ARIA combobox: when the box is focused and empty, a **Recent searches** list opens below it.
- ↑/↓ move, Enter picks, Esc closes, hover + click picks, `✕` removes one entry.
- The dropdown has `data-no-drag` (the top bar is an Electron drag region) and keeps focus in the
  input while clicking.

## Privacy page

`src/screens/Settings/components/privacy/PrivacySettings.tsx`:

```
Privacy
├── Search History   [switch]  "Turning this off … does not delete existing history." + count
└── Clear Data       [Clear Data…] → dialog
```

**Clear Data dialog** (`ClearDataDialog.tsx`): checkbox list of history types — today only
*Search History* (with "N saved searches"; disabled when empty). **Clear Selected** is enabled only
when something is checked; Esc / Cancel / backdrop close. New history types are added as more
`ClearDataOption`s.

The dialog states, and the code guarantees, that it never deletes book files, annotations,
collections, book metadata, reading progress, the FTS5 search index or translation models — the
only effect is `useSearchHistoryStore.clear()` (the enabled setting is unchanged).

## Verification

- Typecheck pass; ESLint on Settings / Library / hooks: no new findings (3 pre-existing).
- In-app browser, production build with a stubbed `window.api` and the real local library:
  - Typing "bell jar" + Enter, then "zola" + Enter → history `["zola", "bell jar"]`; focusing the
    empty box shows both; ↓↓ + Enter picks "bell jar" (filters the list, moves to the top).
  - Privacy: switch off → entries kept, `enabled: false`; Library then shows no dropdown and does
    not record new queries ("rover").
  - Clear Data: dialog lists "Search History · 2 saved searches", Clear Selected disabled until
    checked; clearing empties the list, shows "Search history cleared.", setting unchanged.
- Not verified in the packaged Electron app.

## Not in this phase

Reading History, Recently Opened Books (see above), history for the in-book search panel or the
titlebar search.
