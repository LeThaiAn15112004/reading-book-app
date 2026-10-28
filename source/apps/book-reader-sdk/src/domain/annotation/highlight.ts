import type { MdAnnotation, NoteLocator, NoteSelectionText, PdfAnnotation, TxtAnnotation } from './note.js';

/**
 * `'highlight'` = background fill; `'underline'` = underline stroke; `'strikethrough'` = a line
 * through the middle of the text (reuses the underline mark's geometry, repositioned — see
 * `openEpubjs.ts`); `'textbox'` = a sticky-note anchor with no colored mark at all, just a 📝
 * icon (see `EpubjsHandle.applyHighlight` styleKind branches). Mirrors `note_json.type`.
 */
export type HighlightStyleKind =
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'squiggly'
  | 'replace'
  | 'insert'
  | 'textbox'
  // PDF shapes (pdf_shape_tools.md): annotations of their own kind in the same rows / list / history.
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'arrow'
  // PDF Typewriter note (specs/005-typewriter-note)
  | 'typewriter';

/**
 * Application-facing view of one highlight/underline — a `notes` row whose `note_json.group`
 * is `'annotation'` (or absent, pre-019) and whose `note_json.type` is `'highlight'` or
 * `'underline'`. Plain data, mirroring `BookmarkRecord`'s shape and rationale (no behavior
 * methods; the reader hook owns state transitions).
 */
export interface HighlightRecord {
  id: string;
  bookId: string;
  /** Jump target, same shape as `BookmarkRecord.locator`: a range CFI (`epubcfi(base,start,end)`)
   *  plus `chapterIndex` for EPUB; a `page-rect` (1-based page) plus `chapterIndex` = 0-based page
   *  for PDF. */
  locator: NoteLocator;
  styleKind: HighlightStyleKind;
  colorHex: string;
  note?: string;
  tags: string[];
  /** Selected text + surrounding context (`note_json.locatorExtended.text`). */
  selectionText?: NoteSelectionText;
  /** PDF text markup geometry (`note_json.pdfAnnotation`); absent for EPUB highlights. */
  pdfAnnotation?: PdfAnnotation;
  /** TXT markup range (`note_json.txtAnnotation`); absent for every other format. */
  txtAnnotation?: TxtAnnotation;
  /** Markdown markup anchor (`note_json.mdAnnotation`); absent for every other format. */
  mdAnnotation?: MdAnnotation;
  createdAt: string;
  updatedAt: string;
}
