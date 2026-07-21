import { Location } from './location.js';

export interface BookChunkProps {
  id: string;
  bookId: string;
  chunkIndex: number;
  content: string;
  locationStart?: Location;
  locationEnd?: Location;
  embedding?: Uint8Array | null;
  createdAt: string;
}

/**
 * Extracted text chunk for FTS / RAG (SDS §3 — BOOK_CHUNK).
 * embedding nullable until Phase 2.
 */
export class BookChunk {
  readonly id: string;
  readonly bookId: string;
  readonly chunkIndex: number;
  content: string;
  locationStart?: Location;
  locationEnd?: Location;
  embedding?: Uint8Array | null;
  readonly createdAt: string;

  constructor(props: BookChunkProps) {
    if (!props.id.trim()) throw new Error('BookChunk.id is required');
    if (!Number.isInteger(props.chunkIndex) || props.chunkIndex < 0) {
      throw new Error('BookChunk.chunkIndex must be an integer >= 0');
    }
    if (!props.content.trim()) throw new Error('BookChunk.content is required');

    this.id = props.id;
    this.bookId = props.bookId;
    this.chunkIndex = props.chunkIndex;
    this.content = props.content;
    this.locationStart = props.locationStart;
    this.locationEnd = props.locationEnd;
    this.embedding = props.embedding ?? null;
    this.createdAt = props.createdAt;
  }

  hasEmbedding(): boolean {
    return this.embedding != null && this.embedding.length > 0;
  }

  clearEmbedding(): void {
    this.embedding = null;
  }

  setEmbedding(embedding: Uint8Array): void {
    this.embedding = embedding;
  }

  wordCount(): number {
    return this.content.trim().split(/\s+/).filter(Boolean).length;
  }
}
