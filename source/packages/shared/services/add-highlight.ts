import type { Highlight, OverlayStore } from '@reading-book/domain';

/**
 * Add / upsert a highlight overlay on a book (SDS — AnnotationService.addHighlight).
 */
export class AddHighlightService {
  constructor(private readonly overlays: OverlayStore) {}

  async execute(h: Highlight): Promise<Highlight> {
    await this.overlays.saveHighlight(h);
    return h;
  }
}
