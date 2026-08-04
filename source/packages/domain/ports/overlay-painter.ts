import type { Highlight } from '../models/highlight.js';

/**
 * Overlay paint surface for highlights (SDS §2.6).
 * Adapters: DomCssOverlay (reflow), PdfCanvasOverlay (fixed page).
 */
export interface OverlayPainter {
  paint(overlays: { highlights?: Highlight[] }): Promise<void>;
  clear(): Promise<void>;
}
