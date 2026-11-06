-- Add digital signature support on books (is_signed flag + book_signatures detail).

ALTER TABLE books ADD COLUMN is_signed INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_books_is_signed ON books (is_signed);

CREATE TABLE IF NOT EXISTS book_signatures (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  signer_name TEXT NOT NULL,
  signature_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (signature_status IN ('valid', 'invalid', 'expired', 'unknown')),
  signed_at TEXT,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_book_signatures_book_id ON book_signatures (book_id);
