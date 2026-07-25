-- Overlay comments anchored to a page position (SCR-03 Comment tab).

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  position_data TEXT NOT NULL,
  content TEXT NOT NULL,
  author_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_book_id ON comments (book_id);
