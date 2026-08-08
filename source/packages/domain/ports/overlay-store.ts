import type { Annotation, AnnotationType } from '../models/annotation.js';
import type { Bookmark } from '../models/bookmark.js';
import type { ReadingSessionState } from '../models/reading-session-state.js';

/** Narrowing filter for `listAnnotations`; omitted fields mean "any". */
export interface AnnotationQuery {
  bookId: string;
  types?: AnnotationType[];
  pageNumber?: number;
}

/**
 * Persistence port for reading session + overlay annotations (SDS §2.6 / class diagram).
 */
export interface OverlayStore {
  getSessionState(bookId: string): Promise<ReadingSessionState | undefined>;
  saveSessionState(s: ReadingSessionState): Promise<void>;
  saveAnnotation(a: Annotation): Promise<void>;
  getAnnotation(bookId: string, annotationId: string): Promise<Annotation | undefined>;
  listAnnotations(query: AnnotationQuery): Promise<Annotation[]>;
  deleteAnnotation(bookId: string, annotationId: string): Promise<boolean>;
  saveBookmark(b: Bookmark): Promise<void>;
  listBookmarks(bookId: string): Promise<Bookmark[]>;
  deleteBookmark(bookId: string, bookmarkId: string): Promise<boolean>;
}
