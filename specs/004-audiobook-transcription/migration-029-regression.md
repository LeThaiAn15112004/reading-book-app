# Migration 029 — regression review (2026-10-27)

Scope: does adding migration `029_audio_transcripts.sql` (and its entry in `migrate.ts`) break any older migration or feature, and what does each existing spike really prove about it? Nothing here launched Electron with a window or ran E2E.

## 1. The driver problem (why most spikes cannot prove anything about 029)

- Most spikes use **`node:sqlite`** (Node 22.13), a stand-in for better-sqlite3. It is built **without FTS5**: `CREATE VIRTUAL TABLE … USING fts5` fails with `no such module: fts5` (checked directly on 2026-10-27).
- Migration 021 (`book_chunks_fts`) already could not run there, so every node:sqlite harness skips it. Migration 029 also contains an FTS5 table (`audio_transcript_fts`): applying 001–029 on node:sqlite fails exactly at `029_audio_transcripts.sql` (checked directly).
- Therefore every node:sqlite spike **skips 029**. A green result from them says: "the code and schema they do use still work with 001–028 minus 021 and with the modified SDK/IPC types". It says **nothing** about whether 029 itself is correct or compatible. Skipping is not evidence.
- Only the two spikes on the **real better-sqlite3** (Electron's SQLite 3.53.2 with FTS5, run through `ELECTRON_RUN_AS_NODE`, no window) apply 029: `spike:audio:migration` and `spike:transcription:main`.

## 2. Every spike that touches SQLite

"Driver / 029" was read from the code and confirmed at run time with a tracer that logged which tables each `node:sqlite` database was asked to create (kept outside the repo). Across all runs the tracer never saw `audio_transcripts` or `book_chunks_fts` created in a node:sqlite database, i.e. 021 and 029 were skipped everywhere on node:sqlite, as stated.

| Spike | Driver | Migrations applied | 029 applied? | Result |
|---|---|---|---|---|
| `signature:status` | node:sqlite, own list (files `< 022`, not 021) | 001–020 only (`< 022`, 021 skipped) | no — never reaches 029 | 23 pass |
| `settings:reminders` | node:sqlite, own list | 001–028 except 021 | **skipped** (filter added) | 30 pass |
| `session:roundtrip` | node:sqlite, own tiny schema | none of the app's | no | pass |
| `txt:main` | node:sqlite, own list | 001–028 except 021 | **skipped** (filter added) | 37 pass |
| `txt:store`, `md:main`, `audio:main`, `audio:store`, `audio:zip-import`, `audio:chapters`, `pdf:annotations`, `pdf:live`, `pdf:ink`, `pdf:ink-store`, `pdf:draw-color`, `pdf:shapes`, `pdf:shape-store`, `pdf:two-way` | node:sqlite via `db-stub.mjs` | 001–028 except 021 | **skipped** (filter added to the stub) | all pass (19 / 12 / 60 / 73 / 32 / 12 / 39 / 18 / 12 / 41 / 11 / 12 / 16 / 21 checks) |
| `pdf:embedded` | node:sqlite via `db-stub.mjs` | 001–028 except 021 | **skipped** | failed before the one-line fix below (pre-existing, unrelated to 029); **12 checks pass after it (2026-10-27)** |
| `pdf:graphics`, `pdf:export`, `pdf:attachments`, `audio:zip`, `audio:zip-store` | no SQLite database is created in the run | — | no | pass (not database evidence) |
| `audio:migration` | **real better-sqlite3** (Electron-as-Node) | 001–029 | **yes**, but its own assertions about 029 are only the final "fresh database == migrated database" comparison | 24 pass |
| `transcription:main` | **real better-sqlite3** (Electron-as-Node) | 001–029 | **yes** — section A, A2 (below) and the store checks | 31 pass |

Spikes with no SQLite use (not run, not relevant to this review): `epub:*`, `overlay:cfi`, `theme:contrast`, `settings:reset|shortcuts|notifications|background`, `reader:toolbar|hand`, `pdf:search`, `md:render`; `pdf:compat-kit` needs a directory argument; `e2e*` and `e2e:launch` are manual-only / open a window and were not run.

## 3. What actually proves migration 029 is safe

Only `spike:transcription:main` (real better-sqlite3 + FTS5):

- **A**: schema, CHECK / UNIQUE / FOREIGN KEY rules, FTS5 triggers, `ON DELETE CASCADE` from `books` and from `book_audio_chapters`.
- **A2 (new this turn)**: migrate a database populated through 028 (books of several formats, chapters, `book_chunks` with real `book_chunks_fts` rows), then apply 029 and check that (a) every pre-existing table/index/trigger/FTS definition in `sqlite_master` is byte-identical, (b) exactly these objects were added and nothing else: `audio_transcripts`, `audio_transcript_passages`, `idx_audio_transcript_passages_pos`, `audio_transcript_fts` and its four shadow tables, three FTS triggers, (c) all existing rows are unchanged and `book_chunks_fts` answers the same query, (d) `schema_migrations` gains only `029_audio_transcripts.sql`, after 028, (e) after 029 the old behaviour still works: new chunks are indexed, deleting a book cascades chunks, FTS entries and chapters, `foreign_key_check` and `integrity_check` are clean, (f) re-applying the SQL changes no definition (`IF NOT EXISTS`).
- **Registration / order**: `migrate.ts` lists exactly the files on disk, in order, with 029 last (static check in section A; the file name and the `?raw` import are both asserted).
- `audio:migration` additionally proves that a database migrated 001→029 step by step has the same schema as one migrated in one go.

## 4. Failures and limits that remain

1. **`spike:pdf:embedded` — fixed 2026-10-27 (owner approved).** It failed in check 2 because it expected a Squiggly annotation to be imported as `underline`, while the committed mapping (`pdf-embedded-annotations.ts`, commit `d9f81b9`) imports it as `squiggly`. Neither the mapping, `electron/pdf-sync` nor the spike differed from `HEAD`, and its database layer skips 029, so 029 had no part in it. Fix: the expected list on line 145 of `spikes/pdf-annotations/run-pdf-embedded-annotations.mjs` is now `['highlight','squiggly','strikethrough','textbox','underline']`. After it all 12 checks pass, including 3–12 (ledger, live deletions, app rows), which could not run before.
2. **The real `migrate()` runner is not executed.** It imports SQL with Vite `?raw`, so no spike can load it. The spikes re-implement it (one transaction per file, foreign keys off per migration, `schema_migrations` row) and a static check ties its list to the files. `npx vite build` bundles it without error. A real app start was not run (no Electron window by instruction).
3. **FTS5 behaviour on node:sqlite is untestable** — a permanent limit of that driver, not a bug. Any future migration with FTS5 needs the same two-driver treatment.
4. `spike:audio:migration`'s own checks do not target 029; its 24 passes are about 026–028.

## 5. Harness changes made, and why they do not weaken the checks

| File | Change | Why / what is preserved |
|---|---|---|
| `spikes/pdf-annotations/db-stub.mjs` | also skips `029_*` (comment updated) | node:sqlite cannot execute 029's FTS5 (verified). The skipped file only adds tables none of those spikes touch, exactly like 021. Without it every spike that uses the stub would throw at `029_audio_transcripts.sql`. |
| `spikes/reminders/run-reminders.mjs`, `spikes/txt/run-txt-document.mjs` | filter also skips `029_*` | same reason; both build their own node:sqlite database from the migration files. |
| `spikes/audio/run-audio-migration.mjs` | brings `db` to the latest migration (029+) before its last check "a fresh database migrated through the latest ends in the same schema" | that check compares a one-go migration with the step-by-step one; with a new migration on disk the step-by-step side stopped at 028 and the comparison failed (observed). The assertion itself is unchanged; it now compares like with like and therefore also covers 029. |

No expectation was relaxed to obtain a green run; the one failing spike (`pdf:embedded`) was left failing and reported.
