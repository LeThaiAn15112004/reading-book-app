export { DocumentFormat, isDocumentFormat, parseDocumentFormat } from './document-format.js';
export { Author, BookAuthor } from './author.js';
export type { AuthorProps, BookAuthorProps } from './author.js';
export { Genre, BookGenre } from './genre.js';
export type { GenreProps, BookGenreProps } from './genre.js';
export { Book } from './book.js';
export type { BookProps } from './book.js';
export { BookChunk } from './book-chunk.js';
export type { BookChunkProps } from './book-chunk.js';
export {
  SIGNATURE_STATUSES,
  isSignatureInfoCurrent,
  isSignatureStatus,
  signatureInfoFromMetadata,
  signatureMetadataPatch,
} from './book-signature.js';
export type {
  BookSignatureInfo,
  SignatureMetadataFields,
  SignatureStatus,
} from './book-signature.js';
