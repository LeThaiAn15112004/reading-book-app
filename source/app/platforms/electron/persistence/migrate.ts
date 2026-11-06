import type { Database } from 'better-sqlite3'
import { planMigrations, type Migration } from '@reading-book/book-reader-sdk'
import migration001 from '../../../../core/src/db/desktop/migrations/001_initial.sql?raw'
import migration002 from '../../../../core/src/db/desktop/migrations/002_expand_file_formats.sql?raw'
import migration003 from '../../../../core/src/db/desktop/migrations/003_book_signatures.sql?raw'
import migration004 from '../../../../core/src/db/desktop/migrations/004_comments.sql?raw'
import migration005 from '../../../../core/src/db/desktop/migrations/005_drop_app_settings.sql?raw'
import migration006 from '../../../../core/src/db/desktop/migrations/006_book_library_metadata.sql?raw'
import migration007 from '../../../../core/src/db/desktop/migrations/007_genres_nn.sql?raw'
import migration008 from '../../../../core/src/db/desktop/migrations/008_reading_session_v2.sql?raw'
import migration009 from '../../../../core/src/db/desktop/migrations/009_highlights_v2.sql?raw'
import migration010 from '../../../../core/src/db/desktop/migrations/010_typewriter_notes.sql?raw'
import migration011 from '../../../../core/src/db/desktop/migrations/011_annotations.sql?raw'
import migration012 from '../../../../core/src/db/desktop/migrations/012_annotations_v2.sql?raw'
import migration013 from '../../../../core/src/db/desktop/migrations/013_book_reading_status.sql?raw'
import migration014 from '../../../../core/src/db/desktop/migrations/014_cloud_provenance.sql?raw'
import migration015 from '../../../../core/src/db/desktop/migrations/015_bookmark_excerpt.sql?raw'
import migration016 from '../../../../core/src/db/desktop/migrations/016_annotations_notes.sql?raw'
import migration017 from '../../../../core/src/db/desktop/migrations/017_annotations_location_ref.sql?raw'
import migration018 from '../../../../core/src/db/desktop/migrations/018_notes_thorium.sql?raw'
import migration019 from '../../../../core/src/db/desktop/migrations/019_bookmarks_notes_merge.sql?raw'
import migration020 from '../../../../core/src/db/desktop/migrations/020_optimized_books_schema.sql?raw'
import migration021 from '../../../../core/src/db/desktop/migrations/021_book_chunks_fts.sql?raw'
import migration022 from '../../../../core/src/db/desktop/migrations/022_book_signature_status.sql?raw'
import migration023 from '../../../../core/src/db/desktop/migrations/023_pdf_embedded_annotations.sql?raw'
import migration024 from '../../../../core/src/db/desktop/migrations/024_pdf_annotation_two_way_sync.sql?raw'
import migration025 from '../../../../core/src/db/desktop/migrations/025_txt_documents.sql?raw'
import migration026 from '../../../../core/src/db/desktop/migrations/026_books_audio_format.sql?raw'
import migration027 from '../../../../core/src/db/desktop/migrations/027_books_more_audio_formats.sql?raw'
import migration028 from '../../../../core/src/db/desktop/migrations/028_book_audio_chapters.sql?raw'
import migration029 from '../../../../core/src/db/desktop/migrations/029_audio_transcripts.sql?raw'
import migration030 from '../../../../core/src/db/desktop/migrations/030_audio_transcript_scope.sql?raw'

const MIGRATIONS: Migration[] = [
  { name: '001_initial.sql', sql: migration001 },
  { name: '002_expand_file_formats.sql', sql: migration002 },
  { name: '003_book_signatures.sql', sql: migration003 },
  { name: '004_comments.sql', sql: migration004 },
  { name: '005_drop_app_settings.sql', sql: migration005 },
  { name: '006_book_library_metadata.sql', sql: migration006 },
  { name: '007_genres_nn.sql', sql: migration007 },
  { name: '008_reading_session_v2.sql', sql: migration008 },
  { name: '009_highlights_v2.sql', sql: migration009 },
  { name: '010_typewriter_notes.sql', sql: migration010 },
  { name: '011_annotations.sql', sql: migration011 },
  { name: '012_annotations_v2.sql', sql: migration012 },
  { name: '013_book_reading_status.sql', sql: migration013 },
  { name: '014_cloud_provenance.sql', sql: migration014 },
  { name: '015_bookmark_excerpt.sql', sql: migration015 },
  { name: '016_annotations_notes.sql', sql: migration016 },
  { name: '017_annotations_location_ref.sql', sql: migration017 },
  { name: '018_notes_thorium.sql', sql: migration018 },
  { name: '019_bookmarks_notes_merge.sql', sql: migration019 },
  { name: '020_optimized_books_schema.sql', sql: migration020 },
  { name: '021_book_chunks_fts.sql', sql: migration021 },
  { name: '022_book_signature_status.sql', sql: migration022 },
  { name: '023_pdf_embedded_annotations.sql', sql: migration023 },
  { name: '024_pdf_annotation_two_way_sync.sql', sql: migration024 },
  { name: '025_txt_documents.sql', sql: migration025 },
  { name: '026_books_audio_format.sql', sql: migration026 },
  { name: '027_books_more_audio_formats.sql', sql: migration027 },
  { name: '028_book_audio_chapters.sql', sql: migration028 },
  { name: '029_audio_transcripts.sql', sql: migration029 },
  { name: '030_audio_transcript_scope.sql', sql: migration030 },
]

/**
 * Apply pending SQL migrations in order. Idempotent via schema_migrations.
 *
 * Important: `PRAGMA foreign_keys` is a **no-op inside a transaction**. Migrations that
 * rebuild `books` (DROP + rename) must run with FK disabled at the connection level,
 * otherwise ON DELETE CASCADE wipes `book_authors` / sessions / overlays.
 */
export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `)

  const applied = (db.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>).map((row) => row.name)
  // Which migrations are pending, and in which order, is core's call; names this build does not list are left alone as before.
  const { pending } = planMigrations(applied, MIGRATIONS)

  const insert = db.prepare(
    'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
  )

  for (const migration of pending) {
    db.pragma('foreign_keys = OFF')
    try {
      const applyOne = db.transaction(() => {
        db.exec(migration.sql)
        insert.run(migration.name, new Date().toISOString())
      })
      applyOne()
    } finally {
      db.pragma('foreign_keys = ON')
    }
  }
}
