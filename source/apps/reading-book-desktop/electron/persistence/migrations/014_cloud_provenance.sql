ALTER TABLE books ADD COLUMN source_provider TEXT;
ALTER TABLE books ADD COLUMN external_id TEXT;

CREATE INDEX IF NOT EXISTS idx_books_cloud_provenance
  ON books (source_provider, external_id);
