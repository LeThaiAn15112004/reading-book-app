-- Migration 008 — Rebuild reading_session_states v2
-- Thay thế: bỏ bg_color / text_color / theme_preset (color theme → G4.7 CSS var, không lưu DB)
-- Thêm: font_weight, text_align, layout_mode, page_turn_mode, margins_enabled, margin_preset
--
-- SQLite không hỗ trợ DROP COLUMN trực tiếp → rebuild table:
--   1. Tạo bảng mới _new với schema v2
--   2. Copy dữ liệu (columns chung)
--   3. DROP bảng cũ
--   4. RENAME bảng mới

CREATE TABLE IF NOT EXISTS reading_session_states_new (
  book_id           TEXT    PRIMARY KEY NOT NULL,
  last_read_location TEXT   NOT NULL,
  percent           REAL    NOT NULL DEFAULT 0,

  -- Typography
  font_family       TEXT,
  font_size         REAL,
  font_weight       TEXT,
  line_height       REAL,
  text_align        TEXT,

  -- Layout & page turn
  layout_mode       TEXT,
  page_turn_mode    TEXT,
  margins_enabled   INTEGER,
  margin_preset     TEXT,

  is_landscape      INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT    NOT NULL,

  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

INSERT INTO reading_session_states_new (
  book_id, last_read_location, percent,
  font_family, font_size, line_height,
  is_landscape, updated_at
)
SELECT
  book_id, last_read_location, percent,
  font_family, font_size, line_height,
  is_landscape, updated_at
FROM reading_session_states;

DROP TABLE reading_session_states;

ALTER TABLE reading_session_states_new RENAME TO reading_session_states;
