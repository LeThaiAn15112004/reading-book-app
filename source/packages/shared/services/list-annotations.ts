import type { Annotations } from '../models/annotations.js';

/**
 * List highlights, notes, and bookmarks for a book (SDS — AnnotationService.listByBook).
 * Skeleton: OverlayStore has no list APIs yet — returns empty collections.
 */
export class ListAnnotationsService {
  async execute(_bookId: string): Promise<Annotations> {
    return {
      highlights: [],
      notes: [],
      bookmarks: [],
    };
  }
}
