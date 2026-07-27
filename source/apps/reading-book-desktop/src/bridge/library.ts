/** Typed wrappers for library:* IPC via window.api. */

export const libraryApi = {
  listBooks: () => window.api.library.listBooks(),
  getBook: (id: string) => window.api.library.getBook(id),
  openBookContent: (id: string) => window.api.library.openBookContent(id),
  markAsReading: (id: string) => window.api.library.markAsReading(id),
  deleteBook: (id: string) => window.api.library.deleteBook(id),
}
