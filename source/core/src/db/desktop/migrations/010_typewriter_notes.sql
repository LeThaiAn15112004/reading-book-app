-- Drop comments table and create typewriter_notes table
DROP TABLE IF EXISTS comments;

CREATE TABLE IF NOT EXISTS typewriter_notes (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  position_data TEXT NOT NULL,
  content TEXT NOT NULL,
  font_family TEXT,
  font_size REAL,
  font_color_hex TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_typewriter_notes_book_id ON typewriter_notes (book_id);
