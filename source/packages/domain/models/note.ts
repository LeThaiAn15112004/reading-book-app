import { Location } from './location.js';

export interface NoteProps {
  id: string;
  bookId: string;
  highlightId?: string;
  locationRef: Location;
  selectedText?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** User note at a location; optionally linked to a highlight (SDS §3 — NOTE). */
export class Note {
  readonly id: string;
  readonly bookId: string;
  highlightId?: string;
  locationRef: Location;
  selectedText?: string;
  content: string;
  readonly createdAt: string;
  updatedAt: string;

  constructor(props: NoteProps) {
    if (!props.id.trim()) throw new Error('Note.id is required');
    this.id = props.id;
    this.bookId = props.bookId;
    this.highlightId = props.highlightId;
    this.locationRef = props.locationRef;
    this.selectedText = props.selectedText;
    this.content = props.content;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    if (this.isEmpty()) {
      throw new Error('Note.content must not be empty');
    }
  }

  isEmpty(): boolean {
    return !this.content.trim();
  }

  isAttachedToHighlight(): boolean {
    return Boolean(this.highlightId);
  }

  attachToHighlight(highlightId: string): void {
    this.highlightId = highlightId;
    this.touch();
  }

  detachHighlight(): void {
    this.highlightId = undefined;
    this.touch();
  }

  updateContent(content: string, now = new Date().toISOString()): void {
    if (!content.trim()) throw new Error('Note.content must not be empty');
    this.content = content;
    this.updatedAt = now;
  }

  touch(now = new Date().toISOString()): void {
    this.updatedAt = now;
  }
}
