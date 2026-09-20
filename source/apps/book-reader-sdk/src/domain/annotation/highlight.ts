import type { NoteLocator, NoteSelectionText } from './note.js';

/**
 * `'highlight'` = background fill; `'underline'` = underline stroke; `'strikethrough'` = a line
 * through the middle of the text (reuses the underline mark's geometry, repositioned — see
 * `openEpubjs.ts`); `'textbox'` = a sticky-note anchor with no colored mark at all, just a 📝
 * icon (see `EpubjsHandle.applyHighlight` styleKind branches). Mirrors `note_json.type`.
 */
export type HighlightStyleKind = 'highlight' | 'underline' | 'strikethrough' | 'textbox';

/**
 * Application-facing view of one highlight/underline — a `notes` row whose `note_json.group`
 * is `'annotation'` (or absent, pre-019) and whose `note_json.type` is `'highlight'` or
 * `'underline'`. Plain data, mirroring `BookmarkRecord`'s shape and rationale (no behavior
 * methods; the reader hook owns state transitions).
 */
export interface HighlightRecord {
  id: string;
  bookId: string;
  /** Jump target: a range CFI (`epubcfi(base,start,end)`) plus `chapterIndex`, same shape as
   *  `BookmarkRecord.locator`. */
  locator: NoteLocator;
  styleKind: HighlightStyleKind;
  colorHex: string;
  note?: string;
  tags: string[];
  /** Selected text + surrounding context (`note_json.locatorExtended.text`). */
  selectionText?: NoteSelectionText;
  createdAt: string;
  updatedAt: string;
}
