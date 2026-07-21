import { Location } from './location.js';

export interface HighlightProps {
  id: string;
  bookId: string;
  locationStart: Location;
  locationEnd: Location;
  selectedText: string;
  colorHex: string;
  createdAt: string;
}

/** Highlight overlay on a book (SDS §3 — HIGHLIGHT). */
export class Highlight {
  readonly id: string;
  readonly bookId: string;
  locationStart: Location;
  locationEnd: Location;
  selectedText: string;
  colorHex: string;
  readonly createdAt: string;

  constructor(props: HighlightProps) {
    if (!props.id.trim()) throw new Error('Highlight.id is required');
    if (!props.selectedText.trim()) throw new Error('Highlight.selectedText is required');

    this.id = props.id;
    this.bookId = props.bookId;
    this.locationStart = props.locationStart;
    this.locationEnd = props.locationEnd;
    this.selectedText = props.selectedText;
    this.colorHex = Highlight.normalizeColor(props.colorHex);
    this.createdAt = props.createdAt;
  }

  static normalizeColor(colorHex: string): string {
    const value = colorHex.trim();
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
      throw new Error(`Invalid highlight color: ${colorHex}`);
    }
    return value.toLowerCase();
  }

  recolor(colorHex: string): void {
    this.colorHex = Highlight.normalizeColor(colorHex);
  }

  preview(maxLen = 80): string {
    const text = this.selectedText.trim();
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen - 1)}…`;
  }
}
