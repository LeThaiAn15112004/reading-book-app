import type { Annotation, OverlayStore } from '@reading-book/domain';

/**
 * Add / upsert any overlay annotation on a book (SDS — AnnotationService.save).
 */
export class SaveAnnotationService {
  constructor(private readonly overlays: OverlayStore) {}

  async execute(a: Annotation): Promise<Annotation> {
    await this.overlays.saveAnnotation(a);
    return a;
  }
}
