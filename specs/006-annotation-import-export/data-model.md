# Data Model

No schema migration. Import and export read and write existing `notes` rows. Field names below are the real stored ones
(`INoteState` in `book-reader-sdk/src/domain/annotation/note.ts`, written by `buildHighlightNoteJson` in
`electron/persistence/sqlite-overlay-store.ts`); the file only projects them, it invents no new location model.

## AnnotationFile (`.readmate-notes.json`)
| Field | Type | Rule |
|---|---|---|
| fileVersion | int | `1`; greater than supported -> reject (`newer_version`) |
| exportedBy | string | app name + version |
| exportedAt | ISO 8601 | |
| book | `{ title, author?, format: 'epub'\|'pdf'\|'txt'\|'md', sha256, pageCount? }` | `sha256` = `books.sha256` of the file at export; format must equal the target's; `pageCount` (integer >= 1) is PDF only and optional: the library's page count when known, omitted when not |
| txt | `{ contentSha256 }`? | TXT only: `txt_documents.content_sha256` of the edited copy when one exists (revision numbers are local to a device and are NOT exported) |
| annotations | Annotation[] | not empty on export |

## Annotation (one `notes` row, group `annotation`)
| Field | Source in `note_json` | Rule |
|---|---|---|
| sourceId | row `id` | informational; see "Identity" |
| type (spec: "kind") | `type` (a `HighlightStyleKind`) | highlight, underline, strikethrough, squiggly, replace, insert, textbox, rectangle, ellipse, line, arrow, typewriter; unknown -> counted "not placed" |
| locator | `locatorExtended.locator` | stored JSON verbatim: `{kind:'cfi', cfi, chapterIndex?}` (EPUB, one CFI string), `{kind:'page-rect', page (1-based), rect?, chapterIndex?}` (PDF), `{kind:'text-offset', offset, blockId?, chapterIndex?}` (TXT `blockId` `txt`, Markdown `blockId` `md`) |
| selectionText | `locatorExtended.text` | `{before?, highlight?, after?}` — the quote is `highlight` |
| note | `note` | comment; for `typewriter` it is the document text and is never trimmed |
| tags | `tags` | optional |
| colorHex | `style.colorHex` | `#RRGGBB`, shapes `#RRGGBBAA` |
| pdfAnnotation | `pdfAnnotation` | PDF only: `{pageIndex (0-based), rects[{pageIndex?,x,y,width,height}] normalized 0–1, contents?, caret?, shape?, typewriter?}` |
| txtAnnotation | `txtAnnotation` | TXT only: `{startOffset, endOffset}` UTF-16, canonical text |
| mdAnnotation | `mdAnnotation` | Markdown only: segment + offset start/end (`MdAnnotation`, `md-annotations.ts`) |
| createdAt | `created` / row `created_at` | restored on import |
| modifiedAt | `modified` | informational: `writeHighlight` always stamps "now", so an imported row's modified time is the import time |
| origin | derived | `file` when the row came from a scan of the PDF and the ledger key is not the key of `readmate:<id>`; else `app`. See research R3b (unverified derivation) |
| nm | ledger | PDF `file`-origin only: the annotation's `/NM`, needed to recognise it in a scan |

Import re-validates every payload with the existing parsers (`parsePdfAnnotation`, `parseTxtAnnotation`,
`parseMdAnnotation`, the locator parsers) — an invalid annotation counts as "not placed", never written.

## Identity and duplicates (no dependence on SQLite ids)
Content key = `type` + normalised locator + `selectionText.highlight` + `note` (+ `pdfAnnotation` geometry rounded to 4 decimals for PDF, `txtAnnotation`
offsets for TXT, `mdAnnotation` for Markdown). The same key already in the target book = "present". For PDF `file`-origin
rows the `/NM` key (`nm1:<pageIndex>:<hash53(nm)>#n`, SDK `embeddedAnnotationIdentities`) is checked against a fresh scan.
Row ids: reused only if the id does not exist in ANY book (a reused id of another book would be overwritten by
`writeHighlight`'s upsert); otherwise a new id is assigned.

## ImportPreview (held in Main; the renderer sees a DTO only)
`sessionId`, `fileBook{title,author,format}`, `startedFrom?{bookId,title}` (the book the import was started from, when any), `target{bookId,title,author,matchedBy: 'sha256'|'title'|'chosen'}|null`, `requiresChoice` (true when `startedFrom` differs from the file's book, or the file's book is not in the library), `fileBookMissing?{title,author}`, `toAdd`, `present`,
`notPlaced:[{type, quote?, reason}]`, and the freshness token Main keeps (never sent): target `books.sha256`, target
current TXT `content_sha256`/revision, and the sorted set of existing content keys.

Lifecycle: `pickFile` -> `setTarget` (mandatory when `requiresChoice`: the explicit choice) -> `confirm` -> done | `stale_preview` (re-preview) | `discard`/cancel.

## Results
`ExportResult = {ok, exported, errorCode?}`; `ImportResult = {ok, added, present, notPlaced, errorCode?}`.
errorCodes: `not_found`, `empty`, `cancelled`, `not_annotation_file`, `damaged`, `newer_version`, `format_mismatch`,
`book_missing`, `file_unavailable` (target book file cannot be resolved; message tells the user to relink), `target_not_confirmed` (confirm while `requiresChoice` and no `setTarget` yet), `stale_preview`, `write_failed`.
