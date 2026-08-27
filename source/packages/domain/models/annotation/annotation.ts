/**
 * Unified overlay markup on a book (SDS §3 — ANNOTATION), covering every kind of
 * physical annotation brought into digital reading.
 */
export type AnnotationType =
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'freehand'
  | 'textbox'
  | 'stamp';

/** Action / review state used for checklists and revision queues. */
export type AnnotationStatus = 'None' | 'Review' | 'Done';

const ANNOTATION_TYPES: readonly AnnotationType[] = [
  'highlight',
  'underline',
  'strikethrough',
  'freehand',
  'textbox',
  'stamp',
];

const ANNOTATION_STATUSES: readonly AnnotationStatus[] = ['None', 'Review', 'Done'];

/** Text-range types share the packed `start|end` location and selected-text content. */
const TEXT_RANGE_TYPES: readonly AnnotationType[] = [
  'highlight',
  'underline',
  'strikethrough',
];

/**
 * Presentation attributes stored as JSON in `annotations.style_properties`.
 * Open-ended so each type may add its own keys without a schema change.
 */
export interface AnnotationStyle {
  colorHex?: string;
  strokeWidth?: number;
  opacity?: number;
  fontFamily?: string;
  fontSize?: number;
  /** Inline note written against a markup annotation. */
  note?: string;
  [key: string]: unknown;
}

export interface AnnotationProps {
  id: string;
  bookId: string;
  type: AnnotationType;
  /**
   * 1-based page index; null when the format has no fixed page (e.g. EPUB anchored
   * purely via CFI in `locationData`, or before a virtual page has been computed).
   */
  pageNumber: number | null;
  /**
   * Opaque per-type location: packed `start|end` Location, CFI, or JSON geometry
   * (e.g. `{"cfiRange": "..."}` for EPUB, a bounding box for PDF).
   */
  locationData: string;
  content?: string;
  /** Free-text note the user typed for this annotation, separate from `style.note`. */
  notes?: string | null;
  style?: AnnotationStyle;
  status?: AnnotationStatus;
  isChecked?: boolean;
  createdAt: string;
  updatedAt: string;
}

export class Annotation {
  readonly id: string;
  readonly bookId: string;
  type: AnnotationType;
  pageNumber: number | null;
  locationData: string;
  content?: string;
  notes: string | null;
  style: AnnotationStyle;
  status: AnnotationStatus;
  isChecked: boolean;
  readonly createdAt: string;
  updatedAt: string;

  constructor(props: AnnotationProps) {
    if (!props.id.trim()) throw new Error('Annotation.id is required');
    if (!props.bookId.trim()) throw new Error('Annotation.bookId is required');
    if (!Annotation.isType(props.type)) {
      throw new Error(`Invalid annotation type: ${props.type}`);
    }
    if (!props.locationData.trim()) {
      throw new Error('Annotation.locationData is required');
    }
    if (props.status != null && !Annotation.isStatus(props.status)) {
      throw new Error(`Invalid annotation status: ${props.status}`);
    }

    this.id = props.id.trim();
    this.bookId = props.bookId.trim();
    this.type = props.type;
    this.pageNumber = Annotation.normalizePageNumber(props.pageNumber);
    this.locationData = props.locationData.trim();
    this.content = props.content?.trim() || undefined;
    this.notes = props.notes?.trim() || null;
    this.style = Annotation.normalizeStyle(props.style);
    this.status = props.status ?? 'None';
    this.isChecked = props.isChecked ?? false;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static isType(value: unknown): value is AnnotationType {
    return (
      typeof value === 'string' && ANNOTATION_TYPES.includes(value as AnnotationType)
    );
  }

  static isStatus(value: unknown): value is AnnotationStatus {
    return (
      typeof value === 'string' &&
      ANNOTATION_STATUSES.includes(value as AnnotationStatus)
    );
  }

  /** True for types anchored to a text range rather than page geometry. */
  static isTextRangeType(type: AnnotationType): boolean {
    return TEXT_RANGE_TYPES.includes(type);
  }

  static normalizePageNumber(pageNumber: number | null | undefined): number | null {
    if (pageNumber == null || !Number.isFinite(pageNumber)) return null;
    return Math.max(1, Math.floor(pageNumber));
  }

  static normalizeColor(colorHex: string): string {
    const value = colorHex.trim();
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
      throw new Error(`Invalid annotation color: ${colorHex}`);
    }
    return value.toLowerCase();
  }

  /** Drop undefined entries so `style_properties` stays free of null noise. */
  static normalizeStyle(style?: AnnotationStyle): AnnotationStyle {
    if (!style) return {};
    const out: AnnotationStyle = {};
    for (const [key, value] of Object.entries(style)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' && !value.trim()) continue;
      out[key] = value;
    }
    return out;
  }

  /** Parse a `style_properties` column; malformed JSON degrades to no styling. */
  static parseStyle(raw: string | null | undefined): AnnotationStyle {
    if (!raw?.trim()) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Annotation.normalizeStyle(parsed as AnnotationStyle);
    } catch {
      return {};
    }
  }

  static serializeStyle(style?: AnnotationStyle): string {
    return JSON.stringify(Annotation.normalizeStyle(style));
  }

  get colorHex(): string | undefined {
    return typeof this.style.colorHex === 'string' ? this.style.colorHex : undefined;
  }

  get note(): string | undefined {
    const note = typeof this.style.note === 'string' ? this.style.note.trim() : '';
    return note || undefined;
  }

  hasNote(): boolean {
    return Boolean(this.note);
  }

  serializedStyle(): string {
    return Annotation.serializeStyle(this.style);
  }

  touch(now = new Date().toISOString()): void {
    this.updatedAt = now;
  }

  updateContent(content: string | undefined, now = new Date().toISOString()): void {
    this.content = content?.trim() || undefined;
    this.touch(now);
  }

  updateNotes(notes: string | undefined | null, now = new Date().toISOString()): void {
    this.notes = notes?.trim() || null;
    this.touch(now);
  }

  /** Reposition / re-anchor; optional page when geometry is page-scoped. */
  updateLocation(
    locationData: string,
    pageNumber?: number | null,
    now = new Date().toISOString(),
  ): void {
    const next = locationData.trim();
    if (!next) throw new Error('Annotation.locationData is required');
    this.locationData = next;
    if (pageNumber !== undefined) {
      this.pageNumber = Annotation.normalizePageNumber(pageNumber);
    }
    this.touch(now);
  }

  updateNote(note: string | undefined, now = new Date().toISOString()): void {
    this.mergeStyle({ note: note?.trim() || undefined }, now);
  }

  recolor(colorHex: string, now = new Date().toISOString()): void {
    this.mergeStyle({ colorHex: Annotation.normalizeColor(colorHex) }, now);
  }

  mergeStyle(patch: AnnotationStyle, now = new Date().toISOString()): void {
    this.style = Annotation.normalizeStyle({ ...this.style, ...patch });
    this.touch(now);
  }

  setStatus(status: AnnotationStatus, now = new Date().toISOString()): void {
    if (!Annotation.isStatus(status)) {
      throw new Error(`Invalid annotation status: ${status}`);
    }
    this.status = status;
    this.touch(now);
  }

  setChecked(isChecked: boolean, now = new Date().toISOString()): void {
    this.isChecked = isChecked;
    this.touch(now);
  }

  preview(maxLen = 80): string {
    const text = this.content?.trim() ?? '';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen - 1)}…`;
  }
}
