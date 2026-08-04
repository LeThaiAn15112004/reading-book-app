import type { Bookmark, Highlight } from '@reading-book/domain';

/**
 * Aggregated annotations for a book (SDS class diagram — Annotations).
 * Inline notes live on each Highlight (`note` column); no separate notes table.
 */
export interface Annotations {
  highlights: Highlight[];
  bookmarks: Bookmark[];
}
