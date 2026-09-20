import type { Book, ReadingSessionState } from '../domain/index.js';

/**
 * Opened reader session payload (SDS class diagram — BookSession).
 */
export interface BookSession {
  book: Book;
  sessionState?: ReadingSessionState;
}
