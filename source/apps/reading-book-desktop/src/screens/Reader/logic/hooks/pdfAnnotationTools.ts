import type { PdfAnnotationRect } from '@reading-book/book-reader-sdk'

/**
 * Freehand and stamp notes (`NoteType` in book-reader-sdk `domain/annotation/note.ts`) are
 * intentionally NOT wired up yet — out of scope for PDF text annotations
 * (docs/implementation_plan/pdf_text_annotations.md), which cover highlight / underline /
 * strikethrough / note over the PDF.js text layer only.
 *
 * This file is the placeholder for that future work, kept empty on purpose rather than adding a
 * "Freehand"/"Stamp" button that opens onto nothing. The PDF surface already has what they need:
 * a stable per-page plane (`PdfRenderer` page slots) and `PdfAnnotationLayer`, which paints
 * normalized rects as percentages of the slot. When they land:
 *   - Freehand: one pointer-drag → one stroke, saved as `PdfAnnotation.rects` (an approximating
 *     bounding box per segment) or an SVG path in `NoteStyle` — plus a toolbar button gated on a
 *     new reader capability.
 *   - Stamp: an icon picker (✅ ⭐ ❗), placing a single small `PdfAnnotationRect` at the click
 *     point — same gating.
 * Both reuse the `notes` persistence path PDF text annotations use (`pdfAnnotation` next to a
 * `page-rect` locator), not a new one.
 */
/** TODO(pdf-freehand): a pointer-drag stroke on the given page, saved as `PdfAnnotation.rects` /
 *  an SVG path in `NoteStyle`. */
export function beginFreehandStroke(): PdfAnnotationRect[] {
  return []
}

/** TODO(pdf-stamp): places one icon stamp (a single small `PdfAnnotationRect`) at a page click
 *  point. */
export function placeStamp(): void {}
