import type {
  Annotation,
  AnnotationStatus,
  AnnotationStyle,
  OverlayStore,
} from '@reading-book/domain';

export interface AnnotationPatch {
  content?: string;
  style?: AnnotationStyle;
  status?: AnnotationStatus;
  isChecked?: boolean;
}

/**
 * Patch an existing annotation in place (SDS — AnnotationService.update).
 * Unspecified fields keep their stored value.
 */
export class UpdateAnnotationService {
  constructor(private readonly overlays: OverlayStore) {}

  async execute(
    bookId: string,
    annotationId: string,
    patch: AnnotationPatch,
  ): Promise<Annotation | undefined> {
    const book = bookId.trim();
    const id = annotationId.trim();
    if (!book || !id) return undefined;

    const existing = await this.overlays.getAnnotation(book, id);
    if (!existing) return undefined;

    if (patch.content !== undefined) existing.updateContent(patch.content);
    if (patch.style) existing.mergeStyle(patch.style);
    if (patch.status) existing.setStatus(patch.status);
    if (patch.isChecked !== undefined) existing.setChecked(patch.isChecked);

    await this.overlays.saveAnnotation(existing);
    return existing;
  }
}
