import type { OverlayStore } from '@reading-book/domain';

/**
 * Remove an overlay annotation from a book (SDS — AnnotationService.delete).
 */
export class DeleteAnnotationService {
  constructor(private readonly overlays: OverlayStore) {}

  async execute(bookId: string, annotationId: string): Promise<boolean> {
    const book = bookId.trim();
    const id = annotationId.trim();
    if (!book || !id) return false;
    return this.overlays.deleteAnnotation(book, id);
  }
}
