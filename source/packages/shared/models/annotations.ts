import type { Annotation, Bookmark } from '@reading-book/domain';

export type {
  Annotation,
  AnnotationStatus,
  AnnotationStyle,
  AnnotationType,
} from '@reading-book/domain';

/**
 * Aggregated annotations for a book (SDS class diagram — Annotations).
 */
export interface Annotations {
  items: Annotation[];
  bookmarks: Bookmark[];
}
