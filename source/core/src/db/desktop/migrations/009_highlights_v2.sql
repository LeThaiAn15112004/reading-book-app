-- Migration 009 — highlights v2: single `location`, inline `note` + status; tags N–N.
-- Drop legacy `notes` table (note text lives on `highlights.note`).
-- G5 chưa persist highlight — rebuild an toàn; pipe-pack location_start|location_end nếu có dữ liệu cũ.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS highlights_new (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  location TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  color_hex TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'None'
    CHECK (status IN ('None', 'Accepted', 'Rejected', 'Cancelled', 'Completed', 'Deferred', 'Future')),
  is_checked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

INSERT INTO highlights_new (
  id, book_id, location, selected_text, color_hex,
  note, status, is_checked, created_at, updated_at
)
SELECT
  id,
  book_id,
  location_start || '|' || location_end,
  selected_text,
  color_hex,
  NULL,
  'None',
  0,
  created_at,
  created_at
FROM highlights;

DROP TABLE IF EXISTS notes;

DROP TABLE highlights;

ALTER TABLE highlights_new RENAME TO highlights;

CREATE INDEX IF NOT EXISTS idx_highlights_book_id ON highlights (book_id);
CREATE INDEX IF NOT EXISTS idx_highlights_status ON highlights (status);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  color_hex TEXT
);

CREATE TABLE IF NOT EXISTS highlight_tags (
  highlight_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (highlight_id, tag_id),
  FOREIGN KEY (highlight_id) REFERENCES highlights (id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
);

PRAGMA foreign_keys = ON;
