/** Typed wrappers for bookIndex:* IPC via window.api. */

export const bookIndexApi = {
  ensure: (bookId: string) => window.api.bookIndex.ensure(bookId),
  onStatus: (handler: Parameters<typeof window.api.bookIndex.onStatus>[0]) =>
    window.api.bookIndex.onStatus(handler),
}
