import type { Highlight, OverlayStore } from '@reading-book/domain';

/**
 * Update inline note on an existing highlight (SDS — AnnotationService.updateHighlightNote).
 */
export class UpdateHighlightNoteService {
  constructor(private readonly overlays: OverlayStore) {}

  async execute(h: Highlight): Promise<Highlight> {
    await this.overlays.saveHighlight(h);
    return h;
  }
}
