import type {
  CfiLocationPlain,
  PageRectLocationPlain,
  TextOffsetLocationPlain,
} from '../reading/location.js';

/**
 * Same jump-target shape as `bookmarks.location_ref` (and the old `annotations.location_ref`):
 * a serialized domain `Location` plus the `chapterIndex` captured from the reader's on-screen
 * position at creation time.
 */
export type NoteLocator =
  | (CfiLocationPlain & { chapterIndex?: number })
  | (PageRectLocationPlain & { chapterIndex?: number })
  | (TextOffsetLocationPlain & { chapterIndex?: number });

/** Highlighted text and its surrounding context (Readium Web Annotation `text` block). */
export interface NoteSelectionText {
  before?: string;
  highlight?: string;
  after?: string;
}

/**
 * Readium-style `LocatorExtended` — jump target (`locator`) plus the render/anchor payload
 * (`raw`) needed to redraw the exact markup. `raw` replaces the old opaque
 * `annotations.location_data` column (packed `start|end`, CFI range, or geometry JSON for
 * freehand/textbox/stamp) and is never used to jump, only to restore. Every note carries it;
 * a PDF note's `locator` is a `page-rect` location (jump target + sidebar) and its exact markup
 * geometry lives in `pdfAnnotation` alongside.
 */
export interface LocatorExtended {
  locator: NoteLocator;
  raw?: string;
  text?: NoteSelectionText;
}

/**
 * Axis-aligned rect of a PDF annotation, NORMALIZED to 0–1 against the page box the reader
 * displays (PDF.js viewport at scale 1: crop box, page `/Rotate` applied, top-left origin, y
 * down). Zoom-independent, so it is drawn back as percentages of the page slot. Not PDF user
 * space — exporting into the PDF file would need the inverse viewport transform.
 */
export interface PdfAnnotationRect {
  /** 0-based page of this rect. Absent → `PdfAnnotation.pageIndex` (single-page annotations). */
  pageIndex?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * PDF-only markup geometry. `pageIndex` is 0-based (the first page the annotation touches) —
 * the only 0-based page number in the model; readers, locators and UI use 1-based pages, and
 * `app-models/pdf-highlight.ts` is the single place that converts between the two.
 */
export interface PdfAnnotation {
  pageIndex: number;
  /** Every selected glyph run (multi-line / multi-page selections keep all of them). */
  rects: PdfAnnotationRect[];
  contents?: string;
}

/**
 * TXT-only markup anchor: a half-open range `[startOffset, endOffset)` of UTF-16 code units into the
 * book's canonical text (BOM stripped, `\n` line breaks — `txt/txt-text.ts`). A TXT note's locator is
 * a `text-offset` at `startOffset`; this holds the whole range.
 */
export interface TxtAnnotation {
  startOffset: number;
  endOffset: number;
}

/** Presentation attributes, open-ended so each `NoteType` can add its own keys. */
export interface NoteStyle {
  colorHex?: string;
  strokeWidth?: number;
  opacity?: number;
  fontFamily?: string;
  fontSize?: number;
  [key: string]: unknown;
}

export type NoteType =
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'freehand'
  | 'textbox'
  | 'stamp'
  | 'bookmark';

export type NoteStatus = 'None' | 'Review' | 'Done';

/**
 * Thorium-style discriminator distinguishing a ribbon marker (`bookmark`, formerly its own
 * `bookmarks` table) from markup (`annotation`, everything else in `NoteType`). Absent on rows
 * migrated by 018 (which predates the merge) — callers must treat a missing `group` as
 * `'annotation'`, never assume it is always present.
 */
export type NoteGroup = 'annotation' | 'bookmark';

/** Readium Web Annotation `creator` block. */
export interface NoteCreator {
  type?: 'Person' | 'Organization';
  name?: string;
  id?: string;
}

/**
 * Payload persisted verbatim in `notes.note_json` (SQLite) — one JSON document per row so
 * new fields never require a schema migration. Modeled after Thorium Reader's annotation
 * state: `locatorExtended.locator` is every note's jump target (a CFI for EPUB, a `page-rect`
 * for PDF); PDF text markup additionally stores its exact geometry in `pdfAnnotation`.
 * Every other field is shared across formats. Since migration 019, `notes` also holds what
 * used to be the separate `bookmarks` table — `group: 'bookmark'` (with `type: 'bookmark'`)
 * marks those rows; everything else here still applies to them (locatorExtended for the jump
 * target, `label`/`textualValue` for display, no style/status/isChecked).
 */
export interface INoteState {
  schemaVersion: number;
  type: NoteType;
  /** Jump target (+ selected text). PDF notes carry a `page-rect` locator here too. */
  locatorExtended?: LocatorExtended;
  /** PDF-only markup geometry (page + normalized rects) — absent for text-based notes. */
  pdfAnnotation?: PdfAnnotation;
  /** TXT-only markup range (offsets into the canonical text) — absent for every other format. */
  txtAnnotation?: TxtAnnotation;
  textualValue?: string;
  note?: string | null;
  style?: NoteStyle;
  tags?: string[];
  /** `'bookmark'` | `'annotation'`; missing on pre-merge rows, treat as `'annotation'`. */
  group?: NoteGroup;
  /** Bookmark-only: user-editable display label (`Bookmark.label`). Unused for annotations. */
  label?: string;
  creator?: NoteCreator;
  status?: NoteStatus;
  isChecked?: boolean;
  created?: string;
  modified?: string;
}
