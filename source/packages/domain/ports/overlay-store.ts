import type { Bookmark } from '../models/bookmark.js';
import type { Highlight } from '../models/highlight.js';
import type { ReadingSessionState } from '../models/reading-session-state.js';

/**
 * Persistence port for reading session + overlay annotations (SDS §2.6 / class diagram).
 */
export interface OverlayStore {
  getSessionState(bookId: string): Promise<ReadingSessionState | undefined>;
  saveSessionState(s: ReadingSessionState): Promise<void>;
  saveHighlight(h: Highlight): Promise<void>;
  listHighlights(bookId: string): Promise<Highlight[]>;
  deleteHighlight(bookId: string, highlightId: string): Promise<boolean>;
  saveBookmark(b: Bookmark): Promise<void>;
  listBookmarks(bookId: string): Promise<Bookmark[]>;
  deleteBookmark(bookId: string, bookmarkId: string): Promise<boolean>;
}
