import type { Bookmark } from '../models/bookmark.js';
import type { Highlight } from '../models/highlight.js';
import type { Note } from '../models/note.js';
import type { ReadingSessionState } from '../models/reading-session-state.js';

/**
 * Persistence port for reading session + overlay annotations (SDS §2.6 / class diagram).
 */
export interface OverlayStore {
  getSessionState(bookId: string): Promise<ReadingSessionState | undefined>;
  saveSessionState(s: ReadingSessionState): Promise<void>;
  saveHighlight(h: Highlight): Promise<void>;
  saveNote(n: Note): Promise<void>;
  saveBookmark(b: Bookmark): Promise<void>;
}
