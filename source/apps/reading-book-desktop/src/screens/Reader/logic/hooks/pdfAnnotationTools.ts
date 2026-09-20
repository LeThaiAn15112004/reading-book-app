import type { PdfAnnotationRect } from '@reading-book/book-reader-sdk'

/**
 * Freehand and stamp notes (`NoteType` in packages/domain/models/annotation/note.ts) are
 * intentionally NOT wired up in this app yet — both anchor via `PdfAnnotation.rects`/`pageIndex`,
 * which needs a stable per-page image plane to draw or place icons on. EPUB is reflowable HTML
 * with no such plane (text reflows on every font-size/window change), so there is nothing correct
 * to build against until a PDF renderer exists under `src/reader/renderers/pdf/` — there is none
 * today (only an import-time metadata adapter at `electron/adapters/pdf.adapter.ts`).
 *
 * This file is the placeholder for that future work, kept empty on purpose rather than adding a
 * "Freehand"/"Stamp" button that opens onto nothing. When a PDF renderer lands:
 *   - Freehand: a canvas overlay per page, one pointer-drag → one stroke, saved as
 *     `PdfAnnotation.rects` (an approximating bounding box per segment) or an SVG path in
 *     `NoteStyle` — plus a toolbar button gated on `book.format === 'pdf'`.
 *   - Stamp: an icon picker (✅ ⭐ ❗), placing a single small `PdfAnnotationRect` at the click
 *     point — same toolbar gating.
 * Both would reuse the same `notes` persistence path highlights already use (extend
 * `HighlightRecord`-equivalent handling, or add a sibling `PdfAnnotationRecord`), not a new one.
 */
/** TODO(pdf-renderer): implement once src/reader/renderers/pdf exists — a pointer-drag stroke on
 *  the given page, saved as `PdfAnnotation.rects`/an SVG path in `NoteStyle`. */
export function beginFreehandStroke(): PdfAnnotationRect[] {
  return []
}

/** TODO(pdf-renderer): implement once src/reader/renderers/pdf exists — places one icon stamp
 *  (a single small `PdfAnnotationRect`) at a page click point. */
export function placeStamp(): void {}
