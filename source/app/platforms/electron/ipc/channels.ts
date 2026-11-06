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
  /** Open a document link (http/https/mailto only) in the OS default handler. */
  openExternalLink: 'app:openExternalLink',
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
  /** Renderer-rendered first page (PDF / DOCX / TXT / MD) stored as the book's cover when it has none. */
  setGeneratedCover: 'library:setGeneratedCover',
  updateMetadata: 'library:updateMetadata',
  showInFolder: 'library:showInFolder',
  copyFilePath: 'library:copyFilePath',
  removeBook: 'library:removeBook',
  deleteBookFile: 'library:deleteBookFile',
  /** Multi-chapter audiobooks only: delete the app-owned chapter folder, rows and cover. */
  removeAudiobook: 'library:removeAudiobook',
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
  /** Renderer → main: abort the in-flight URL download. */
  cancel: 'import:cancel',
  /** Main → renderer: step / byte progress, sent only once a file has been picked. */
  progress: 'import:progress',
} as const

export const CloudChannels = {
  connect: 'cloud:connect',
  disconnect: 'cloud:disconnect',
  getAccessToken: 'cloud:getAccessToken',
  downloadAndImport: 'cloud:downloadAndImport',
  /** Renderer → main: abort the in-flight download of one catalog entry. */
  cancelDownload: 'cloud:cancelDownload',
  /** Main → renderer: streamed byte progress while a cloud download is in flight. */
  downloadProgress: 'cloud:downloadProgress',
} as const

export const OverlayChannels = {
  getSessionState: 'overlay:getSessionState',
  saveSessionState: 'overlay:saveSessionState',
  getAudioProgress: 'overlay:getAudioProgress',
  saveAudioProgress: 'overlay:saveAudioProgress',
  listBookmarks: 'overlay:listBookmarks',
  saveBookmark: 'overlay:saveBookmark',
  deleteBookmark: 'overlay:deleteBookmark',
  listHighlights: 'overlay:listHighlights',
  saveHighlight: 'overlay:saveHighlight',
  deleteHighlight: 'overlay:deleteHighlight',
  /** PDF freehand Ink strokes (`notes` rows of type `ink`) — never mixed with highlights. */
  listInk: 'overlay:listInk',
  saveInk: 'overlay:saveInk',
  deleteInk: 'overlay:deleteInk',
  /** Renderer → main: watch the open PDF's file and sync its embedded annotations (now + on change). */
  watchPdfEmbeddedAnnotations: 'overlay:watchPdfEmbeddedAnnotations',
  /** Renderer → main: stop watching (book closed / switched). */
  unwatchPdfEmbeddedAnnotations: 'overlay:unwatchPdfEmbeddedAnnotations',
  /** Main → renderer: a sync of the watched PDF changed rows (always sent for the open sync). */
  pdfEmbeddedAnnotationsChanged: 'overlay:pdfEmbeddedAnnotationsChanged',
  /** Renderer → main: save a NEW PDF with the book's annotations written in (save dialog in Main). */
  exportAnnotatedPdf: 'overlay:exportAnnotatedPdf',
  /** Renderer → main: the user confirmed writing annotations into this (digitally signed) PDF. */
  confirmSignedPdfWrite: 'overlay:confirmSignedPdfWrite',
  /** Renderer → main: open two-way conflicts of a book. */
  listPdfAnnotationConflicts: 'overlay:listPdfAnnotationConflicts',
  /** Renderer → main: resolve one conflict (keep Readmate's version / use the PDF's). */
  resolvePdfAnnotationConflict: 'overlay:resolvePdfAnnotationConflict',
} as const

export const ZipImportChannels = {
  /** Native ZIP picker + inspection; the renderer never supplies a path. */
  pick: 'zipImport:pick',
  /** Inspect the ZIP picked in the ordinary "Add file" dialog (its path is held in Main). */
  inspectPicked: 'zipImport:inspectPicked',
  coverPreview: 'zipImport:coverPreview',
  confirm: 'zipImport:confirm',
  discard: 'zipImport:discard',
  cancelInspect: 'zipImport:cancelInspect',
  /** Abort the running import (honoured until the database write). */
  cancelImport: 'zipImport:cancelImport',
  /** Main → renderer: chapters written so far during an import. */
  progress: 'zipImport:progress',
  /** Main → renderer: a ZIP was picked and inspection started (never sent while the picker is open). */
  inspecting: 'zipImport:inspecting',
} as const

export const AudioChannels = {
  /** Chapters the audio file declares about itself (unvalidated seconds). */
  getChapters: 'audio:getChapters',
  /** Tracks of a multi-chapter audiobook (ids, titles, durations — never paths); `[]` for single-file books. */
  getTracks: 'audio:getTracks',
  getBookmarks: 'audio:getBookmarks',
  saveBookmarks: 'audio:saveBookmarks',
} as const

export const AttachmentChannels = {
  /** Files embedded in the book's PDF (descriptors only, never bytes or paths). */
  list: 'attachments:list',
  /** Extract one attachment in Main and hand it to the OS (or refuse by policy). */
  open: 'attachments:open',
  /** Explicit Save As of one attachment through a Main-owned save dialog. */
  saveAs: 'attachments:saveAs',
  /** Place a file on a PDF page: Main checks the file can be written, opens the picker, embeds the file (specs/007). */
  create: 'attachments:create',
  /** Move or delete a Readmate-made page attachment — reaches the file or is refused (specs/007). */
  change: 'attachments:change',
} as const

export const GraphicsChannels = {
  /** Graphic objects inside the book's PDF (Square / Circle / Ink / Line / FreeText …): descriptors only. */
  list: 'graphics:list',
  /** Resize / recolour / delete ONE of them, written into the PDF as an incremental update. */
  apply: 'graphics:apply',
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

export const BackgroundChannels = {
  /** Renderer → main: Settings → Background & System Tray switches (owned by Main). */
  getPrefs: 'background:getPrefs',
  /** Renderer → main: change one or both switches; Main persists, then shows / removes the tray. */
  setPrefs: 'background:setPrefs',
  /** Renderer → main: Settings → Reset App Settings — Main writes its own defaults. */
  resetPrefs: 'background:resetPrefs',
  /** Renderer → main: Start at Login (OS login item; launched hidden in the tray). */
  getStartAtLogin: 'background:getStartAtLogin',
  setStartAtLogin: 'background:setStartAtLogin',
  /** Renderer → main: quit for real (raises the quitting flag first, like the tray's Quit). */
  quit: 'background:quit',
} as const

export const NotificationChannels = {
  /** Renderer → main: whether the OS lets this app show notifications (Settings → Notifications). */
  getSupport: 'notifications:getSupport',
  /** Renderer → main: master switch + Reading Reminders (owned by Main — the reminder worker runs there). */
  getPrefs: 'notifications:getPrefs',
  setEnabled: 'notifications:setEnabled',
  setReminder: 'notifications:setReminder',
  /** Renderer → main: Settings → Reset App Settings — Main writes its own defaults. */
  resetPrefs: 'notifications:resetPrefs',
  /** Renderer → main: show the reading reminder now (Settings preview). */
  sendTestReminder: 'notifications:sendTestReminder',
  /** Main → renderer: a reading-reminder notification was clicked — open this book. */
  openBook: 'notifications:openBook',
} as const

export const UpdateChannels = {
  /** Renderer → main: check for a newer version via this channel's update provider. */
  check: 'updates:check',
} as const

export const StorageChannels = {
  /** Renderer → main: usage figures for Settings → Storage. */
  getUsage: 'storage:getUsage',
  /** Renderer → main: clear Chromium cache + rebuildable search index (never books/notes). */
  clearCache: 'storage:clearCache',
  /** Renderer → main: delete one downloaded translation model by id. */
  removeTranslationModel: 'storage:removeTranslationModel',
  /** Renderer → main: delete one downloaded speech (transcription) model by id; refused while a transcription runs. */
  removeSpeechModel: 'storage:removeSpeechModel',
  /** Renderer → main: open the managed-books folder in the OS file manager. */
  openBooksFolder: 'storage:openBooksFolder',
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

export const TxtChannels = {
  /** Renderer → main: decoded canonical text (edited copy if there is one) + its annotations. */
  open: 'txt:open',
  /** Renderer → main: atomically save edited text + annotation changes against a revision. */
  commit: 'txt:commit',
} as const

export const TranscriptionChannels = {
  /** Renderer → main: transcript summary, the book's job (if any) and the speech models. */
  getInfo: 'transcription:getInfo',
  /** Renderer → main: start (or queue) a transcription of the whole book, one track or a time range. */
  start: 'transcription:start',
  /** Renderer → main: cancel a queued or running job. */
  cancel: 'transcription:cancel',
  /** Renderer → main: download one speech model (only after the user confirmed in the UI). */
  downloadModel: 'transcription:downloadModel',
  /** Renderer → main: transcript passages in playback order. */
  getPassages: 'transcription:getPassages',
  /** Renderer → main: full-text search inside one transcript. */
  search: 'transcription:search',
  /** Renderer → main: export the transcript as plain text through a Main-owned save dialog. */
  export: 'transcription:export',
  /** Renderer → main: delete a book's transcript. */
  delete: 'transcription:delete',
  /** Main → renderer: job progress snapshot (throttled). */
  progress: 'transcription:progress',
  /** Main → renderer: new passages were committed for a span of a book. */
  passagesAdded: 'transcription:passagesAdded',
  /** Main → renderer: speech-model download progress. */
  modelProgress: 'transcription:modelProgress',
} as const

/** Annotation import / export (specs/006-annotation-import-export). The renderer sends only `bookId` / `sessionId`, never a path. */
export const AnnotationTransferChannels = {
  /** How many annotations a book has (enables or disables the Export menu items). */
  count: 'annotationTransfer:count',
  /** Save the restorable `.readmate-notes.json` (save dialog in Main). */
  exportRestore: 'annotationTransfer:exportRestore',
  /** Save the readable Markdown copy (save dialog in Main). */
  exportReadable: 'annotationTransfer:exportReadable',
  /** Open dialog in Main + validate the file + build the import preview (a Main-held session). */
  pickFile: 'annotationTransfer:pickFile',
  /** The user's explicit choice of target book for a preview. */
  setTarget: 'annotationTransfer:setTarget',
  /** Re-validate and write the previewed import in one transaction. */
  confirm: 'annotationTransfer:confirm',
  discard: 'annotationTransfer:discard',
  cancel: 'annotationTransfer:cancel',
  /** Main → renderer: reading / planning / committing progress of an import. */
  progress: 'annotationTransfer:progress',
} as const
