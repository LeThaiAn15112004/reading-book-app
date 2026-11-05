# Data Model: Readmate Mobile

Desktop's stored formats are the contract (FR-021). This document adds only what differs on Mobile. No Desktop schema changes.

## Mobile baseline schema

The exact column list is taken at M3 from a fully migrated Desktop database, not from reading migration text, because many tables were rebuilt across the 30 migrations.

| Group | Tables | First release |
|---|---|---|
| Library | `books`, `authors`, `book_authors`; no genre table: genres are names in `books.genres_json` (confirmed at M3, T040) | Yes |
| Collections | `collections`, `collection_books` | Yes |
| Overlay | `notes`, holding highlights, notes and bookmarks (confirmed at M3: bookmarks are `notes` rows with `group = bookmark`) | Yes |
| Reading state | `books.reading_state_json` | Yes |
| TXT | `txt_documents` | Not needed while read-only |
| Audio, transcripts, FTS chunks, PDF ledgers | Audio chapters, transcripts, `book_chunks`, `pdf_embedded_annotations`, `pdf_annotation_write_back` | No |

The baseline is `web/src/db/migrations/001_baseline.sql` (T041), taken from `scripts/dump-desktop-schema.mjs`; a test checks it has Desktop's exact columns and indexes. Libraries made by old Desktop versions also have `notes.page_number` and its index, which a fresh Desktop migration does not create and Desktop never writes; Mobile follows the fresh schema.

Mobile has its own numbered migrations, starting at `001_baseline`. They are unrelated to Desktop's numbers. Database files are not interchangeable (spec edge case).

## Entities

### Book (Mobile differences only)

| Field | Rule |
|---|---|
| `id` | UUID |
| `sha256` | Unique; same algorithm as Desktop; hash of the imported bytes; duplicate check |
| `file_path` | Path relative to app-private storage: `books/{id}/file`. Absolute paths change after iOS app updates, so they are never stored |
| `cover_path` | Relative: `covers/{id}.png` |
| `file_format` | `epub`, `pdf`, `txt` or `md` |
| `metadata_json` | Same shape; `signatureStatus` stays absent, meaning not checked |
| `reading_state_json` | Same shape |

`coverUrl` in DTOs is the local server's URL, built per launch and never stored.

### Annotation row (`notes`)

Same `note_json` as Desktop for: EPUB highlights and notes, `page-rect` PDF markup with `pdfAnnotation`, Markdown `mdAnnotation`, TXT `txtAnnotation`, and bookmarks. Mobile creates only these kinds. Reading rows with other kinds must preserve them unchanged, though none can exist in the first release.

**Validation**: same as Desktop's Main re-validation, using SDK functions where they exist. Writes go through one store path.

**TXT, resolved at M3 (T045)**: a TXT markup row has exactly Desktop's shape, and `MobileOverlayStore` reads and writes it like any other row (the contract fixture `txt-underline` passes on both apps). Desktop writes TXT rows only inside `txt:commit`, together with a text revision; Mobile has no text revisions because TXT is read-only in the first release, so the bridge refuses a TXT save before the store, as Main refuses `txtAnnotationRef` in `overlay:saveHighlight`. Mobile therefore creates no TXT rows in the first release.

### Import job (in memory)

```text
idle → picking → copying → hashing → checking → storing → done
                     any step → failed | cancelled → cleanup
```

- Work happens under `staging/{uuid}/`, moved to `books/{id}/` only just before the row is committed.
- If the move succeeds and the commit fails, the file is removed.
- At startup, `staging/` is emptied, and `books/` folders without a row are removed.
- `duplicate` is a result, not an error, and leaves nothing behind.

### Preferences

Stored in `localStorage`, same keys as Desktop. Main-owned Desktop preferences (background, notifications) do not exist on Mobile.

## Removal

`removeBook` runs in order: delete rows in one transaction, then delete `books/{id}/` and the cover. Leftover files are caught by the startup sweep. A leftover row pointing at no file can't occur in this order.

## Contract fixtures

Versioned JSON under `book-reader-sdk/tests/contracts/fixtures/v1/`, one per `note_json` kind, plus reading state and a book row, run by one shared runner (`contract-runner.ts`). Desktop: `npm run spike:contract:fixtures` (real `SqliteOverlayStore` / `SqliteLibraryStore`, real better-sqlite3), 39 of 39 checks. Mobile: `npm test -w reading-book-mobile` (Mobile stores on `node:sqlite`), 39 of 39. The SDK's `persistence/sql-notes.ts` fails them (`sql-notes-mismatch.test.ts`). Each must round-trip with no field lost.
