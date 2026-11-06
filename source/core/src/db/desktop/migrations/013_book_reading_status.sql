ALTER TABLE books
  ADD COLUMN reading_status TEXT NOT NULL DEFAULT 'not-started'
  CHECK (reading_status IN ('reading', 'completed', 'not-started'));

UPDATE books
SET reading_status = 'reading'
WHERE EXISTS (
  SELECT 1
  FROM reading_session_states AS session
  WHERE session.book_id = books.id
    AND TRIM(session.last_read_location) <> ''
);

CREATE INDEX IF NOT EXISTS idx_books_reading_status
  ON books (reading_status);
