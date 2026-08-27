/** Fixed IPC channel names — preload may only invoke these. */

export const AppChannels = {
  ping: 'app:ping',
  getAppInfo: 'app:getAppInfo',
  getGoogleOAuthConfig: 'app:getGoogleOAuthConfig',
  /** Sync native titleBarOverlay caption buttons to Night/Sepia/Paper. */
  setChromeTheme: 'app:setChromeTheme',
  /** Whether the BrowserWindow is currently fullscreen. */
  getFullscreen: 'app:getFullscreen',
  /** Enter or leave OS-level fullscreen. */
  setFullscreen: 'app:setFullscreen',
  /** Toggle OS-level fullscreen; returns the resulting state. */
  toggleFullscreen: 'app:toggleFullscreen',
  /** Main → renderer: fullscreen entered/left (F11, Esc, caption, or IPC). */
  fullscreenChanged: 'app:fullscreenChanged',
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
  markAsCompleted: 'library:markAsCompleted',
  setFavorite: 'library:setFavorite',
  updateMetadata: 'library:updateMetadata',
  showInFolder: 'library:showInFolder',
  copyFilePath: 'library:copyFilePath',
  removeBook: 'library:removeBook',
  deleteBookFile: 'library:deleteBookFile',
  listCollections: 'library:listCollections',
  createCollection: 'library:createCollection',
  updateCollection: 'library:updateCollection',
  deleteCollection: 'library:deleteCollection',
  addBookToCollection: 'library:addBookToCollection',
  removeBookFromCollection: 'library:removeBookFromCollection',
} as const

export const ImportChannels = {
  fromFile: 'import:fromFile',
  fromUrl: 'import:fromUrl',
} as const

export const CloudChannels = {
  connect: 'cloud:connect',
  disconnect: 'cloud:disconnect',
  getAccessToken: 'cloud:getAccessToken',
  downloadAndImport: 'cloud:downloadAndImport',
  /** Main → renderer: streamed byte progress while a cloud download is in flight. */
  downloadProgress: 'cloud:downloadProgress',
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
