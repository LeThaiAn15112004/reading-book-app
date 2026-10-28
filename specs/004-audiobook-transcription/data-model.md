# Data Model: Audiobook Transcription

All timestamps are milliseconds from the start of the passage's own audio file (a single-file book has one implicit file; a multi-track book uses the chapter file).

## Transcript (`audio_transcripts`)

| Field | Notes |
|---|---|
| `id` | text PK |
| `book_id` | FK → `books.id`, `ON DELETE CASCADE`, UNIQUE (one transcript per audiobook) |
| `language` | Whisper language code, or `auto` |
| `model_id` | model used for the passages (e.g. `whisper-base`) |
| `status` | `partial` \| `complete` \| `failed` \| `cancelled` (derived from coverage + last job outcome; "no transcript" is the absence of a row, not a status) |
| `job_state` | nullable `queued` \| `running`; set when a job for this book is accepted, cleared (NULL) when it ends for any reason. A non-NULL value found at app start means the previous process died mid-job (see recovery rule below) |
| `last_error` | nullable `TranscriptionErrorCode` of the last ended job (`INTERRUPTED` after crash recovery) |
| `covered_json` | `{ "<trackId or 'main'>": [[startMs,endMs], ...] }`, merged, sorted |
| `created_at`, `updated_at` | ISO text |

## Transcript Passage (`audio_transcript_passages`)

| Field | Notes |
|---|---|
| `id` | integer PK (ordering key) |
| `transcript_id` | FK, cascade |
| `track_id` | nullable; null for single-file books, `book_audio_chapters.id` otherwise |
| `start_ms`, `end_ms` | `0 ≤ start < end`, within the file duration |
| `text` | trimmed, non-empty |

**Ordering**: playback order is the existing `book_audio_chapters.position` (authoritative, `UNIQUE (book_id, position)`); no separate ordering column is added. Ordered reads use `LEFT JOIN book_audio_chapters c ON c.id = p.track_id ... ORDER BY COALESCE(c.position, 0), p.start_ms, p.id` (single-file passages have `track_id` NULL and sort as position 0). Index `(transcript_id, track_id, start_ms)` serves per-track range reads and active-passage lookup. FTS5 table `audio_transcript_fts(text)` kept in step by triggers.

## Transcription Job (in memory, plus last outcome on the transcript)

| Field | Notes |
|---|---|
| `jobId`, `bookId` | at most one active/queued job per book |
| `scope` | `{ kind:'whole' } \| { kind:'track', trackId } \| { kind:'range', trackId?, startMs, endMs }` |
| `language`, `modelId` | chosen at start |
| `state` | `queued → preparing (model/disk) → running → done` or `failed` / `cancelled` (a job never survives a restart; see recovery) |
| `progress` | `{ doneMs, totalMs, trackId?, trackDoneMs?, trackTotalMs? }` |
| `error` | code from contract (`MODEL_MISSING`, `DISK_FULL`, `FILE_MISSING`, `UNSUPPORTED_LANGUAGE`, `NO_SPEECH`, `DECODE_FAILED`, `ABORTED`, `INTERRUPTED`, `INTEGRITY_FAILED`) |

## Rules and transitions

- Passages in an interval are written together with that interval being added to `covered_json` (one transaction).
- Re-running a covered interval is a no-op unless the user chose "Replace" (deletes passages of the transcript first, after confirmation).
- **Startup recovery** (idempotent): at app start, after migrations and before IPC accepts `start`, every transcript with `job_state IS NOT NULL` gets `job_state = NULL`, `last_error = 'INTERRUPTED'`, and `status = 'partial'` if it has any passage/coverage, otherwise `failed`. It never sets `complete`, never deletes passages, and a second run finds nothing to change. Resume = start the same scope again; covered intervals are skipped.
- Deleting a book cascades; `library:removeAudiobook` needs no extra code beyond the FK.
- Status is `complete` only when the last requested scope ⊆ covered; `NO_SPEECH` when a finished scope produced zero passages.
- `books.reading_state_json` and audio progress are NOT touched.
