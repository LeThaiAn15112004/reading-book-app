-- Drop old tables
DROP TABLE IF EXISTS typewriter_notes;
DROP TABLE IF EXISTS highlight_tags;
DROP TABLE IF EXISTS highlights;

-- Create unified annotations table
CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  type TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  location_data TEXT NOT NULL,
  content TEXT,
  color_hex TEXT,
  font_family TEXT,
  font_size REAL,
  status TEXT NOT NULL DEFAULT 'None',
  is_checked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_annotations_book_id ON annotations (book_id);
CREATE INDEX IF NOT EXISTS idx_annotations_type ON annotations (type);
CREATE INDEX IF NOT EXISTS idx_annotations_status ON annotations (status);

-- Create annotation_tags mapping table
CREATE TABLE IF NOT EXISTS annotation_tags (
  annotation_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (annotation_id, tag_id),
  FOREIGN KEY (annotation_id) REFERENCES annotations (id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
);
