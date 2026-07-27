-- Library card metadata (G1-N7): short description + page/section count.
-- Note: `genre` TEXT was interim; superseded by genres / book_genres in 007.
ALTER TABLE books ADD COLUMN description TEXT;
ALTER TABLE books ADD COLUMN genre TEXT;
ALTER TABLE books ADD COLUMN page_count INTEGER;
