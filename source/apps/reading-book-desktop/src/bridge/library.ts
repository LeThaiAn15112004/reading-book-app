/** Typed wrappers for library:* IPC via window.api. */

export const libraryApi = {
  listBooks: () => window.api.library.listBooks(),
  getBook: (id: string) => window.api.library.getBook(id),
  openBookContent: (id: string) => window.api.library.openBookContent(id),
  markAsReading: (id: string) => window.api.library.markAsReading(id),
  markAsCompleted: (id: string) => window.api.library.markAsCompleted(id),
  setFavorite: (id: string, value: boolean) =>
    window.api.library.setFavorite(id, value),
  updateMetadata: (input: Parameters<typeof window.api.library.updateMetadata>[0]) =>
    window.api.library.updateMetadata(input),
  showInFolder: (id: string) => window.api.library.showInFolder(id),
  copyFilePath: (id: string) => window.api.library.copyFilePath(id),
  removeBook: (id: string) => window.api.library.removeBook(id),
  deleteBookFile: (id: string) => window.api.library.deleteBookFile(id),
  listCollections: () => window.api.library.listCollections(),
  createCollection: (
    input: Parameters<typeof window.api.library.createCollection>[0],
  ) => window.api.library.createCollection(input),
  updateCollection: (
    id: string,
    input: Parameters<typeof window.api.library.updateCollection>[1],
  ) => window.api.library.updateCollection(id, input),
  deleteCollection: (id: string) => window.api.library.deleteCollection(id),
  addBookToCollection: (collectionId: string, bookId: string) =>
    window.api.library.addBookToCollection(collectionId, bookId),
  removeBookFromCollection: (collectionId: string, bookId: string) =>
    window.api.library.removeBookFromCollection(collectionId, bookId),
}
