import type { Bookmark, Highlight, Note } from '@reading-book/domain';

/**
 * Aggregated annotations for a book (SDS class diagram — Annotations).
 */
export interface Annotations {
  highlights: Highlight[];
  notes: Note[];
  bookmarks: Bookmark[];
}
