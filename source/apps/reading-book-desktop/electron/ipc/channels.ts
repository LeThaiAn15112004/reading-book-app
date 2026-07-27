/** Fixed IPC channel names — preload may only invoke these. */

export const AppChannels = {
  ping: 'app:ping',
  getAppInfo: 'app:getAppInfo',
  /** Sync native titleBarOverlay caption buttons to Night/Sepia/Paper. */
  setChromeTheme: 'app:setChromeTheme',
} as const

export const LibraryChannels = {
  listBooks: 'library:listBooks',
  getBook: 'library:getBook',
  /** Open sandboxed book bytes by id (T3.4); never exposes filesystem paths. */
  openBookContent: 'library:openBookContent',
  /** Mark book as in-progress → Library Reading shelf. */
  markAsReading: 'library:markAsReading',
  deleteBook: 'library:deleteBook',
} as const

export const ImportChannels = {
  fromFile: 'import:fromFile',
  fromUrl: 'import:fromUrl',
} as const

export const OverlayChannels = {
  list: 'overlay:list',
  addHighlight: 'overlay:addHighlight',
  addNote: 'overlay:addNote',
  listBookmarks: 'overlay:listBookmarks',
} as const
