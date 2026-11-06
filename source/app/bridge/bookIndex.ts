/** Typed wrappers for bookIndex:* IPC via api. */

import { api } from '../platforms/api'
export const bookIndexApi = {
  ensure: (bookId: string) => api.bookIndex.ensure(bookId),
  onStatus: (handler: Parameters<typeof api.bookIndex.onStatus>[0]) =>
    api.bookIndex.onStatus(handler),
}
