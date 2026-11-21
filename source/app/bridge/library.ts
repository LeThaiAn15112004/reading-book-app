/** Typed wrappers for library:* IPC via api. */

import { api } from '../platforms/api'
export const libraryApi = {
  listBooks: () => api.library.listBooks(),
  getBook: (id: string) => api.library.getBook(id),
  openBookContent: (id: string) => api.library.openBookContent(id),
  markAsReading: (id: string) => api.library.markAsReading(id),
  markAsCompleted: (id: string) => api.library.markAsCompleted(id),
  restartBook: (id: string) => api.library.restartBook(id),
  setGeneratedCover: (id: string, png: ArrayBuffer) =>
    api.library.setGeneratedCover(id, png),
  /** Spec 016: what a generated cover is drawn from (text / EPUB documents / PDF size). */
  getCoverSource: (id: string) => api.library.getCoverSource(id),
  /** Spec 016: ≤ 1 MiB of a book's file (PDF page 1 by ranges). */
  readBookRange: (bookId: string, offset: number, length: number) =>
    api.library.readBookRange({ bookId, offset, length }),
  setFavorite: (id: string, value: boolean) =>
    api.library.setFavorite(id, value),
  updateMetadata: (input: Parameters<typeof api.library.updateMetadata>[0]) =>
    api.library.updateMetadata(input),
  showInFolder: (id: string) => api.library.showInFolder(id),
  copyFilePath: (id: string) => api.library.copyFilePath(id),
  removeBook: (id: string) => api.library.removeBook(id),
  deleteBookFile: (id: string) => api.library.deleteBookFile(id),
  removeAudiobook: (id: string) => api.library.removeAudiobook(id),
  relinkBook: (id: string) => api.library.relinkBook(id),
  checkSignature: (id: string) => api.library.checkSignature(id),
  listCollections: () => api.library.listCollections(),
  createCollection: (
    input: Parameters<typeof api.library.createCollection>[0],
  ) => api.library.createCollection(input),
  updateCollection: (
    id: string,
    input: Parameters<typeof api.library.updateCollection>[1],
  ) => api.library.updateCollection(id, input),
  deleteCollection: (id: string) => api.library.deleteCollection(id),
  addBookToCollection: (collectionId: string, bookId: string, sortOrder?: number) =>
    api.library.addBookToCollection(collectionId, bookId, sortOrder),
  addBooksToCollection: (collectionId: string, bookIds: string[]) =>
    api.library.addBooksToCollection(collectionId, bookIds),
  removeBookFromCollection: (collectionId: string, bookId: string) =>
    api.library.removeBookFromCollection(collectionId, bookId),
}
