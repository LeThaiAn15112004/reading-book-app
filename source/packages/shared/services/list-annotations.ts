import type { OverlayStore } from '@reading-book/domain';
import type { Annotations } from '../models/annotations.js';

/**
 * List highlights and bookmarks for a book (SDS — AnnotationService.listByBook).
 */
export class ListAnnotationsService {
  constructor(private readonly overlays: OverlayStore) {}

  async execute(bookId: string): Promise<Annotations> {
    const id = bookId.trim();
    if (!id) return { highlights: [], bookmarks: [] };
    const highlights = await this.overlays.listHighlights(id);
    return {
      highlights,
      bookmarks: [],
    };
  }
}
