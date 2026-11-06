-- Migration 021 — Full-text search (FTS5) over `book_chunks`.
--
-- 1) Rebuild `book_chunks` around a stable INTEGER PRIMARY KEY (`seq`).
--    An FTS5 external-content table joins back to its content table by rowid. The old table
--    (`id TEXT PRIMARY KEY`) only had an implicit rowid, which VACUUM is allowed to renumber —
--    that would silently point every FTS hit at the wrong chunk. `seq` is a real rowid alias, so
--    it never moves. `id` keeps its deterministic sha1 value (now UNIQUE, not the PK), so
--    `INSERT OR IGNORE` in book-chunk-writer.ts still dedupes re-runs.
--
-- 2) New `word_start` / `word_count`: the word number of the chunk's first word within the whole
--    book, and its word count ("word" = FTS5 unicode61 token, see book-reader-sdk
--    `countSearchWords`). A match's word number in the book is then
--    word_start + words before the match inside the chunk — no scan of earlier chunks.
--
-- 3) The old rows are DROPPED, not copied. `book_chunks` is derived data, re-extractable at any
--    time from the read-only source file, and old rows have no word counts. The next time each
--    book is opened, electron/chunking re-chunks it in the background (hasBookChunks() is false).
--
-- 4) `book_chunks_fts`: FTS5 index in external-content mode. The text is stored once (in
--    `book_chunks`); FTS5 only stores the inverted index. Triggers keep it in sync — including
--    ON DELETE CASCADE from `books`, which fires the child table's DELETE triggers.
--
--    tokenize 'unicode61 remove_diacritics 2' — Unicode word splitting, case-insensitive and
--      diacritic-insensitive ("viet" finds "Việt"; `đ` stays distinct from `d`). Case and diacritics
--      can still be matched exactly: FTS5 narrows to candidate chunks, and the exact counting
--      pass in electron/search re-checks each hit with the user's options.
--    prefix '2 3' — extra index for 2- and 3-character prefixes, so search-as-you-type queries
--      (`"old ma"*`) don't have to expand the prefix against every term in the library.
--
-- The migration runner wraps this file in a transaction with foreign keys OFF, so DROP TABLE
-- does not cascade anywhere.

DROP TABLE IF EXISTS book_chunks;

CREATE TABLE book_chunks (
  seq            INTEGER PRIMARY KEY,
  id             TEXT    NOT NULL UNIQUE,
  book_id        TEXT    NOT NULL,
  chunk_index    INTEGER NOT NULL,
  content        TEXT    NOT NULL,
  location_start TEXT,
  location_end   TEXT,
  word_start     INTEGER NOT NULL DEFAULT 0,
  word_count     INTEGER NOT NULL DEFAULT 0,
  embedding      BLOB,
  created_at     TEXT    NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

-- Also covers "chunks of one book" and MIN/MAX(seq) per book (seq is the rowid, so it's in the index).
CREATE UNIQUE INDEX idx_book_chunks_book_index ON book_chunks (book_id, chunk_index);

CREATE VIRTUAL TABLE book_chunks_fts USING fts5(
  content,
  content = 'book_chunks',
  content_rowid = 'seq',
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);

CREATE TRIGGER book_chunks_fts_after_insert AFTER INSERT ON book_chunks BEGIN
  INSERT INTO book_chunks_fts (rowid, content) VALUES (new.seq, new.content);
END;

-- External content: a delete must hand FTS5 the exact text that was indexed.
CREATE TRIGGER book_chunks_fts_after_delete AFTER DELETE ON book_chunks BEGIN
  INSERT INTO book_chunks_fts (book_chunks_fts, rowid, content)
  VALUES ('delete', old.seq, old.content);
END;

-- Only the indexed columns: a later embedding write (Phase 2 / RAG) must not re-index the text.
CREATE TRIGGER book_chunks_fts_after_update AFTER UPDATE OF seq, content ON book_chunks BEGIN
  INSERT INTO book_chunks_fts (book_chunks_fts, rowid, content)
  VALUES ('delete', old.seq, old.content);
  INSERT INTO book_chunks_fts (rowid, content) VALUES (new.seq, new.content);
END;
