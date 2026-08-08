import type { AnnotationStatus } from './annotation.js';
import { Location } from './location.js';

/** Task / review status on a highlight — same vocabulary as `annotations.status`. */
export type HighlightStatus = AnnotationStatus;

export interface HighlightProps {
  id: string;
  bookId: string;
  /** Packed range: `start|end` (Location.toString() each side). */
  location: string;
  selectedText: string;
  colorHex: string;
  note?: string;
  status?: HighlightStatus;
  isChecked?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Text-range view model used by renderers and overlay painters.
 * Persistence goes through `Annotation` (`annotations` table).
 */
export class Highlight {
  readonly id: string;
  readonly bookId: string;
  location: string;
  selectedText: string;
  colorHex: string;
  note?: string;
  status: HighlightStatus;
  isChecked: boolean;
  readonly createdAt: string;
  updatedAt: string;

  constructor(props: HighlightProps) {
    if (!props.id.trim()) throw new Error('Highlight.id is required');
    if (!props.location.trim()) throw new Error('Highlight.location is required');
    if (!props.selectedText.trim()) throw new Error('Highlight.selectedText is required');

    this.id = props.id;
    this.bookId = props.bookId;
    this.location = props.location.trim();
    this.selectedText = props.selectedText;
    this.colorHex = Highlight.normalizeColor(props.colorHex);
    this.note = props.note?.trim() || undefined;
    this.status = props.status ?? 'None';
    this.isChecked = props.isChecked ?? false;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static normalizeColor(colorHex: string): string {
    const value = colorHex.trim();
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
      throw new Error(`Invalid highlight color: ${colorHex}`);
    }
    return value.toLowerCase();
  }

  /** Pack start/end locations into the single DB `location` column. */
  static packLocation(start: Location, end: Location): string {
    return `${start.toString()}|${end.toString()}`;
  }

  /** Split packed location back into start/end Location value objects. */
  static unpackLocation(packed: string): { start: Location; end: Location } {
    const sep = packed.indexOf('|');
    if (sep <= 0 || sep >= packed.length - 1) {
      throw new Error(`Invalid highlight location: ${packed}`);
    }
    return {
      start: Location.parse(packed.slice(0, sep)),
      end: Location.parse(packed.slice(sep + 1)),
    };
  }

  recolor(colorHex: string): void {
    this.colorHex = Highlight.normalizeColor(colorHex);
    this.touch();
  }

  updateNote(note: string | undefined, now = new Date().toISOString()): void {
    const trimmed = note?.trim();
    this.note = trimmed || undefined;
    this.updatedAt = now;
  }

  hasNote(): boolean {
    return Boolean(this.note?.trim());
  }

  touch(now = new Date().toISOString()): void {
    this.updatedAt = now;
  }

  preview(maxLen = 80): string {
    const text = this.selectedText.trim();
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen - 1)}…`;
  }
}
