import type { Highlight, OverlayStore } from '@reading-book/domain';

/**
 * Add a highlight overlay on a book (SDS — AnnotationService.addHighlight).
 */
export class AddHighlightService {
  constructor(private readonly overlays: OverlayStore) {}

  async execute(_h: Highlight): Promise<Highlight> {
    throw new Error('AddHighlightService.execute: not implemented');
  }
}
