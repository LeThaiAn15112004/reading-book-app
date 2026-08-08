/** Fixed IPC channel names — preload may only invoke these. */

export const AppChannels = {
  ping: 'app:ping',
  getAppInfo: 'app:getAppInfo',
  /** Sync native titleBarOverlay caption buttons to Night/Sepia/Paper. */
  setChromeTheme: 'app:setChromeTheme',
  /** Main → renderer: flush reading session before window close (T4.2). */
  requestFlushSession: 'app:requestFlushSession',
  /** Renderer → main: session flush finished (or timed out client-side). */
  flushSessionDone: 'app:flushSessionDone',
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
  listAnnotations: 'overlay:listAnnotations',
  saveAnnotation: 'overlay:saveAnnotation',
  updateAnnotation: 'overlay:updateAnnotation',
  deleteAnnotation: 'overlay:deleteAnnotation',
  listBookmarks: 'overlay:listBookmarks',
  saveBookmark: 'overlay:saveBookmark',
  deleteBookmark: 'overlay:deleteBookmark',
  getSessionState: 'overlay:getSessionState',
  saveSessionState: 'overlay:saveSessionState',
} as const
