import type { NoteLocator } from './note.js';

/**
 * Application-facing view of one bookmark — a `notes` row whose
 * `note_json.group === 'bookmark'` (see migration 019, which folded the old standalone
 * `bookmarks` table into `notes`).
 *
 * Plain data on purpose: the pre-merge `Bookmark` class carried `rename()`/`moveTo()`/
 * `hasLabel()` that no caller ever used — the IPC layer built a flat record and wrote it
 * straight through — so behavior is left to the reader hook that owns bookmark state.
 */
export interface BookmarkRecord {
  id: string;
  bookId: string;
  /** Jump target: serialized `Location` plus the `chapterIndex` captured at creation time. */
  locator: NoteLocator;
  /** User-editable display name (`note_json.label`). */
  label?: string;
  /** Opening text at the bookmarked spot, for list previews (`note_json.textualValue`). */
  excerpt?: string;
  createdAt: string;
}
