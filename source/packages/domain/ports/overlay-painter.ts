import type { Highlight } from '../models/highlight.js';
import type { Note } from '../models/note.js';

/**
 * Overlay paint surface for highlights / notes (SDS §2.6).
 * Adapters: DomCssOverlay (reflow), PdfCanvasOverlay (fixed page).
 */
export interface OverlayPainter {
  paint(overlays: { highlights?: Highlight[]; notes?: Note[] }): Promise<void>;
  clear(): Promise<void>;
}
