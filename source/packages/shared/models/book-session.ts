import type { Book } from '@reading-book/domain';
import type { ReadingSessionState } from '@reading-book/domain';

/**
 * Opened reader session payload (SDS class diagram — BookSession).
 */
export interface BookSession {
  book: Book;
  sessionState?: ReadingSessionState;
}
