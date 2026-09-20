import type { BookmarkRecord } from '../domain/annotation/bookmark.js';
import type { HighlightRecord, HighlightStyleKind } from '../domain/annotation/highlight.js';
import type { NoteLocator, NoteSelectionText } from '../domain/annotation/note.js';
import type { ReadingSessionState } from '../domain/reading-session-state.js';

/** Insert when `id` is absent; update that row's locator/label/excerpt when it is present. */
export interface SaveBookmarkInput {
  id?: string;
  bookId: string;
  locator: NoteLocator;
  label?: string;
  excerpt?: string;
  /** Preserved on update; defaults to now on insert. */
  createdAt?: string;
}

/**
 * Insert when `id` is absent; update that row's style/note/tags/locator when present. One
 * call handles create, color change, highlight↔underline toggle, note edit, and tag edit —
 * a highlight never needs to be deleted and recreated to change its style.
 */
export interface SaveHighlightInput {
  id?: string;
  bookId: string;
  locator: NoteLocator;
  styleKind: HighlightStyleKind;
  colorHex: string;
  note?: string;
  tags?: string[];
  selectionText?: NoteSelectionText;
  /** Preserved on update; defaults to now on insert. */
  createdAt?: string;
}

/**
 * Persistence port for reading session state (SDS §2.6 / class diagram), bookmarks, and
 * highlights.
 *
 * Bookmarks live in the unified `notes` table as rows with `note_json.group === 'bookmark'`
 * (migration 019). Highlights/underlines live in the same table as rows with
 * `note_json.group === 'annotation'` (or absent, pre-019) and `note_json.type` of `'highlight'`
 * or `'underline'` — see `packages/domain/models/annotation/note.ts`.
 */
export interface OverlayStore {
  getSessionState(bookId: string): Promise<ReadingSessionState | undefined>;
  saveSessionState(s: ReadingSessionState): Promise<void>;

  listBookmarks(bookId: string): Promise<BookmarkRecord[]>;
  saveBookmark(input: SaveBookmarkInput): Promise<BookmarkRecord>;
  deleteBookmark(bookId: string, id: string): Promise<boolean>;

  listHighlights(bookId: string): Promise<HighlightRecord[]>;
  saveHighlight(input: SaveHighlightInput): Promise<HighlightRecord>;
  deleteHighlight(bookId: string, id: string): Promise<boolean>;
}
