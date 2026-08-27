import { Location } from '../reading/location.js';

export interface BookmarkProps {
  id: string;
  bookId: string;
  locationRef: Location;
  label?: string;
  /** Opening text captured at the bookmarked location, for list previews. */
  excerpt?: string;
  createdAt: string;
}

/** Bookmark / ribbon marker (SDS §3 — BOOKMARK). */
export class Bookmark {
  readonly id: string;
  readonly bookId: string;
  locationRef: Location;
  label?: string;
  excerpt?: string;
  readonly createdAt: string;

  constructor(props: BookmarkProps) {
    if (!props.id.trim()) throw new Error('Bookmark.id is required');
    this.id = props.id;
    this.bookId = props.bookId;
    this.locationRef = props.locationRef;
    this.label = props.label?.trim() || undefined;
    this.excerpt = props.excerpt?.trim() || undefined;
    this.createdAt = props.createdAt;
  }

  hasLabel(): boolean {
    return Boolean(this.label);
  }

  rename(label?: string): void {
    this.label = label?.trim() || undefined;
  }

  moveTo(location: Location): void {
    this.locationRef = location;
  }

  displayLabel(fallback = 'Bookmark'): string {
    return this.label?.trim() || fallback;
  }
}
