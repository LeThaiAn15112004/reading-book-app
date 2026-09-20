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
 * freehand/textbox/stamp) and is never used to jump, only to restore. Used for EPUB / TXT /
 * MD / DOCX notes; PDF notes use `pdfAnnotation` instead.
 */
export interface LocatorExtended {
  locator: NoteLocator;
  raw?: string;
  text?: NoteSelectionText;
}

/** Axis-aligned rect in unscaled PDF page coordinates. */
export interface PdfAnnotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** PDF-only markup geometry — page index plus one or more rects for the anchor. */
export interface PdfAnnotation {
  pageIndex: number;
  rects: PdfAnnotationRect[];
  contents?: string;
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
 * state: `locatorExtended` anchors text-based books, `pdfAnnotation` anchors PDF books.
 * The two are optional and mutually exclusive per note (selected by book format / `type`);
 * every other field is shared across formats. Since migration 019, `notes` also holds what
 * used to be the separate `bookmarks` table — `group: 'bookmark'` (with `type: 'bookmark'`)
 * marks those rows; everything else here still applies to them (locatorExtended for the jump
 * target, `label`/`textualValue` for display, no style/status/isChecked).
 */
export interface INoteState {
  schemaVersion: number;
  type: NoteType;
  /** EPUB / TXT / MD / DOCX anchor — absent for PDF notes. */
  locatorExtended?: LocatorExtended;
  /** PDF-only anchor (page + rects) — absent for text-based notes. */
  pdfAnnotation?: PdfAnnotation;
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
