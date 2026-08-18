export interface CommentProps {
  id: string;
  bookId: string;
  /** 1-based page index within the document (PDF-oriented; other formats may map analogously). */
  pageNumber: number;
  /** Serialized position on the page (e.g. JSON `{ x, y }` or bounding box). */
  positionData: string;
  content: string;
  /** Optional display name of who wrote the comment. */
  authorName?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Page-anchored comment / annotation answer (SDS §3 — COMMENT).
 * Local overlay only — not a social feed. SCR-03 sidebar Comment tab.
 */
export class Comment {
  readonly id: string;
  readonly bookId: string;
  pageNumber: number;
  positionData: string;
  content: string;
  authorName?: string;
  readonly createdAt: string;
  updatedAt: string;

  constructor(props: CommentProps) {
    if (!props.id.trim()) throw new Error('Comment.id is required');
    if (!props.bookId.trim()) throw new Error('Comment.bookId is required');
    if (!Number.isFinite(props.pageNumber) || props.pageNumber < 1) {
      throw new Error('Comment.pageNumber must be a positive integer');
    }
    if (!props.positionData.trim()) {
      throw new Error('Comment.positionData is required');
    }
    if (!props.content.trim()) {
      throw new Error('Comment.content must not be empty');
    }

    this.id = props.id;
    this.bookId = props.bookId;
    this.pageNumber = Math.floor(props.pageNumber);
    this.positionData = props.positionData;
    this.content = props.content.trim();
    this.authorName = props.authorName?.trim() || undefined;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  touch(now = new Date().toISOString()): void {
    this.updatedAt = now;
  }

  updateContent(content: string): void {
    if (!content.trim()) throw new Error('Comment.content must not be empty');
    this.content = content.trim();
    this.touch();
  }
}
