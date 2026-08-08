import type { AnnotationType, OverlayStore } from '@reading-book/domain';
import type { Annotations } from '../models/annotations.js';

/**
 * List annotations and bookmarks for a book (SDS — AnnotationService.listByBook).
 */
export class ListAnnotationsService {
  constructor(private readonly overlays: OverlayStore) {}

  async execute(bookId: string, types?: AnnotationType[]): Promise<Annotations> {
    const id = bookId.trim();
    if (!id) return { items: [], bookmarks: [] };
    const [items, bookmarks] = await Promise.all([
      this.overlays.listAnnotations(types?.length ? { bookId: id, types } : { bookId: id }),
      this.overlays.listBookmarks(id),
    ]);
    return { items, bookmarks };
  }
}
