export type SignatureStatus = 'valid' | 'invalid' | 'expired' | 'unknown';

export interface BookSignatureProps {
  id: string;
  bookId: string;
  signerName: string;
  signatureStatus?: SignatureStatus;
  /** ISO-8601 datetime when the signature was applied (optional). */
  signedAt?: string;
}

/**
 * Digital signature metadata for a book (SDS §3 — BOOK_SIGNATURE).
 * A book may have zero or more signatures; `Book.isSigned` is the denormalized flag.
 */
export class BookSignature {
  readonly id: string;
  readonly bookId: string;
  signerName: string;
  signatureStatus: SignatureStatus;
  signedAt?: string;

  constructor(props: BookSignatureProps) {
    if (!props.id.trim()) throw new Error('BookSignature.id is required');
    if (!props.bookId.trim()) throw new Error('BookSignature.bookId is required');
    if (!props.signerName.trim()) {
      throw new Error('BookSignature.signerName is required');
    }

    this.id = props.id;
    this.bookId = props.bookId;
    this.signerName = props.signerName.trim();
    this.signatureStatus = props.signatureStatus ?? 'unknown';
    this.signedAt = props.signedAt;
  }
}
