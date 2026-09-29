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
  /** Snapshot tool: crop a screen region from the reader window and copy it to the clipboard. */
  captureSnapshot: 'app:captureSnapshot',
} as const

export const LibraryChannels = {
  listBooks: 'library:listBooks',
  getBook: 'library:getBook',
  /** Open a registered book's bytes by id (T3.4); never exposes filesystem paths. */
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
  /** "Locate file": re-attach a book to a moved file, verified by SHA-256. */
  relinkBook: 'library:relinkBook',
  /** Verify (or re-use a still-current cached) digital-signature status of a book file. */
  checkSignature: 'library:checkSignature',
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
  getSessionState: 'overlay:getSessionState',
  saveSessionState: 'overlay:saveSessionState',
  listBookmarks: 'overlay:listBookmarks',
  saveBookmark: 'overlay:saveBookmark',
  deleteBookmark: 'overlay:deleteBookmark',
  listHighlights: 'overlay:listHighlights',
  saveHighlight: 'overlay:saveHighlight',
  deleteHighlight: 'overlay:deleteHighlight',
} as const

export const BookIndexChannels = {
  /** Renderer → main: make sure a book's text is chunked (background; returns immediately). */
  ensure: 'bookIndex:ensure',
  /** Main → renderer: background chunking started / finished / failed. */
  status: 'bookIndex:status',
} as const

export const SearchChannels = {
  /** Renderer → main: FTS5 search inside one book (counts + word positions + snippets). */
  searchBook: 'search:searchBook',
} as const

export const TranslationChannels = {
  /** Renderer → main: translate a text selection offline (worker thread). */
  translate: 'translation:translate',
  /** Renderer → main: cancel a pending translate request by id. */
  cancel: 'translation:cancel',
  /** Main → renderer: model download / load progress for a pending request. */
  progress: 'translation:progress',
} as const

export const WordCountChannels = {
  /** Renderer → main: total + per-chapter word counts, from the same chunk index as search. */
  getStats: 'wordCount:getStats',
} as const
