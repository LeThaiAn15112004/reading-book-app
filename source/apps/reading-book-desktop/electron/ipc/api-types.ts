/** Narrow Desktop API exposed to the renderer via contextBridge (`window.api`). */

export type DocumentFormatDto = 'epub' | 'pdf' | 'txt' | 'md' | 'docx' | 'doc'

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
}

export interface GoogleOAuthClientConfigDto {
  clientType: 'installed' | 'web'
  clientId: string
  projectId?: string
  authUri?: string
  tokenUri?: string
  authProviderCertUrl?: string
  redirectUris: readonly string[]
  scopes: readonly string[]
  hasClientSecret: boolean
}

/** Shelf / nav reading status (user-marked completed; not derived from %). */
export type ReadingStatusDto = 'reading' | 'completed' | 'not-started'

/** Plain book metadata for IPC (not a domain class). */
export interface BookSummaryDto {
  id: string
  title: string
  format: DocumentFormatDto
  /** Renderer-safe cover URL (`rb-cover://…`); never an absolute filesystem path. */
  coverUrl?: string
  addedAt: string
  updatedAt: string
  /** Display author(s); optional until import metadata lands (G2). */
  author?: string
  /** Original filename for Library search (FR-08). */
  fileName?: string
  /** File size in bytes (Library card MB). */
  fileSizeBytes?: number
  /** Short blurb for Library list / Book info. */
  description?: string
  /** Genre / subject names (from books.genres_json). */
  genres?: string[]
  /** Page or spine-section count when known. */
  pageCount?: number
  isFavorite?: boolean
  readingStatus?: ReadingStatusDto
  /** Human-readable last-read location; when set, enables Continue Reading. */
  lastReadLocation?: string
  lastReadAt?: string
  noteCount?: number
  /** Cloud Sources provenance — set only for books downloaded from a linked provider. */
  sourceProvider?: CloudProviderDto
  externalId?: string
  /**
   * `managed`: an app-owned copy the app may delete. `referenced`: the user's own file, registered
   * by path — the app never deletes it, and it can go missing if the user moves it.
   */
  fileStorage: BookFileStorageDto
}

export type BookFileStorageDto = 'managed' | 'referenced'

export interface OkResult {
  ok: boolean
}

/** Screen region for the Snapshot tool, in CSS px relative to the reader window's viewport
 *  (same coordinate space as `PointerEvent.clientX/clientY`) — never a filesystem path or image
 *  data, which never needs to cross into Main for this feature. */
export interface SnapshotRegionDto {
  x: number
  y: number
  width: number
  height: number
}

// ─── Cloud Sources ──────────────────────────────────────────────────────────

export type CloudProviderDto = 'google_drive' | 'dropbox' | 'onedrive'

export interface CloudCatalogEntryDto {
  externalId: string
  sourceProvider: CloudProviderDto
  title: string
  authorNames?: string[]
  formatHint?: string
  downloadUrl?: string
  previewUrl?: string
  coverUrl?: string
  fileSizeBytes?: number
  publishedDate?: string
  description?: string
  mimeType?: string
}

export interface CloudConnectResult {
  ok: boolean
  errorMessage?: string
}

export interface CloudDownloadResult {
  ok: boolean
  bookId: string | null
  errorCode?: ImportErrorCode
  errorMessage?: string
}

/** Streamed byte progress for one in-flight cloud download (main → renderer). */
export interface CloudDownloadProgressDto {
  externalId: string
  sourceProvider: CloudProviderDto
  receivedBytes: number
  /** Total size from the provider's Content-Length header, or null when unknown. */
  totalBytes: number | null
}

export interface UpdateBookMetadataInput {
  id: string
  title: string
  author?: string
  genres?: string[]
  description?: string
  pageCount?: number
}

export interface CollectionSummaryDto {
  id: string
  name: string
  description?: string
  bookIds: string[]
  createdAt: string
  updatedAt: string
}

/** Stable codes for library.openBookContent failures (T3.4). */
export type OpenBookErrorCode =
  | 'not_found'
  | 'missing_file'
  | 'path_denied'
  | 'read_failed'

/**
 * Book file bytes for the renderer. Never includes a filesystem path —
 * Main resolves and validates the registered `books.file_path` itself.
 */
export interface OpenBookContentResult {
  ok: boolean
  bookId: string
  format?: DocumentFormatDto
  /** Binary payload for engines (e.g. epubjs ArrayBuffer open). */
  data?: ArrayBuffer
  byteLength?: number
  errorCode?: OpenBookErrorCode
  /** Short user-facing message when ok is false. */
  errorMessage?: string
}

/** Stable codes for library.relinkBook outcomes other than success. */
export type RelinkBookErrorCode =
  /** User closed the file dialog — not an error to surface. */
  | 'cancelled'
  | 'not_found'
  /** Chosen file isn't the book's format, or lives in the app's own data folder. */
  | 'wrong_file'
  /** Chosen file's SHA-256 differs from the one recorded for this book. */
  | 'hash_mismatch'
  | 'read_failed'

export interface RelinkBookResult {
  ok: boolean
  errorCode?: RelinkBookErrorCode
  /** Short user-facing message when ok is false and the user didn't cancel. */
  errorMessage?: string
}

/** Stable codes for import failures (URL download / copy / format / dedup). */
export type ImportErrorCode =
  | 'scheme'
  | 'timeout'
  | 'too_large'
  | 'network'
  | 'not_direct_file'
  | 'http_status'
  | 'copy_failed'
  | 'unsupported_format'
  /** SHA-256 already in library (BR-03); bookId is the existing row. */
  | 'duplicate'

export interface ImportResult {
  ok: boolean
  bookId: string | null
  errorCode?: ImportErrorCode
  /** Short user-facing message when ok is false. */
  errorMessage?: string
}

/** Clone-safe reading session for IPC (T4.3). Location is Location.toString() JSON. */
export interface ReadingSessionStateDto {
  bookId: string
  /** Machine-readable Location JSON when the session has a resumable location. */
  lastReadLocation?: string
  /** Human-readable label for Library / Continue Reading. */
  lastReadLabel?: string
  /** Scrubber map 0–100; not "% complete". */
  percent: number
  fontFamily?: string
  fontSize?: number
  fontWeight?: string
  lineHeight?: number
  textAlign?: string
  layoutMode?: string
  pageTurnMode?: string
  marginsEnabled?: boolean
  marginPreset?: string
  isLandscape?: boolean
  /** ISO timestamp — maps from DB `updated_at` / DTO `lastReadAt`. */
  updatedAt: string
}

/** Input for overlay:saveSessionState — location and typography/layout are independent. */
export interface SaveReadingSessionStateInput {
  bookId: string
  lastReadLocation?: string
  lastReadLabel?: string
  percent?: number
  fontFamily?: string
  fontSize?: number
  fontWeight?: string
  lineHeight?: number
  textAlign?: string
  layoutMode?: string
  pageTurnMode?: string
  marginsEnabled?: boolean
  marginPreset?: string
  isLandscape?: boolean
  updatedAt?: string
}

/**
 * Clone-safe bookmark for IPC (FR-11). `locatorRef` is the jump target serialized the same way
 * `ReadingSessionStateDto.lastReadLocation` is — `Location.toString()` JSON, plus the
 * `chapterIndex` the reader was on when the bookmark was placed.
 */
export interface BookmarkDto {
  id: string
  bookId: string
  locatorRef: string
  label?: string
  excerpt?: string
  createdAt: string
}

/** Input for overlay:saveBookmark — omit `id` to insert, pass it to update that bookmark. */
export interface SaveBookmarkInput {
  bookId: string
  id?: string
  locatorRef: string
  label?: string
  excerpt?: string
  createdAt?: string
}

export interface DeleteBookmarkInput {
  bookId: string
  id: string
}

/**
 * Clone-safe highlight/underline for IPC. `locatorRef` is the jump target serialized the same
 * way `BookmarkDto.locatorRef` is (a range CFI, plus `chapterIndex`); `selectionTextRef` is the
 * JSON of the captured `{before?, highlight?, after?}` selection context, when present.
 */
export interface HighlightDto {
  id: string
  bookId: string
  locatorRef: string
  styleKind: 'highlight' | 'underline' | 'strikethrough' | 'textbox'
  colorHex: string
  note?: string
  tags: string[]
  selectionTextRef?: string
  createdAt: string
  updatedAt: string
}

/** Input for overlay:saveHighlight — omit `id` to insert, pass it to update that highlight. */
export interface SaveHighlightInput {
  bookId: string
  id?: string
  locatorRef: string
  styleKind: 'highlight' | 'underline' | 'strikethrough' | 'textbox'
  colorHex: string
  note?: string
  tags?: string[]
  selectionTextRef?: string
  createdAt?: string
}

export interface DeleteHighlightInput {
  bookId: string
  id: string
}

/** Outcome of asking Main to chunk a book's text for search (returns before the work finishes). */
export interface EnsureBookIndexResult {
  /**
   * ready = chunks already exist; indexing = a background worker is running (a
   * `BookIndexStatusDto` follows); unsupported = format has no text extractor yet; error = failed.
   */
  state: 'ready' | 'indexing' | 'unsupported' | 'error'
}

/** Main → renderer push while a book is being chunked in the background. */
export interface BookIndexStatusDto {
  bookId: string
  state: 'indexing' | 'done' | 'error'
  chunkCount?: number
  errorMessage?: string
}

/** Reading order (Foxit-style list) or FTS5 bm25 relevance of the containing chunk. */
export type BookSearchOrderDto = 'position' | 'relevance'

export interface BookSearchRequestDto {
  bookId: string
  /** Raw user input; split into words the same way the FTS5 index was (unicode61). */
  query: string
  matchCase?: boolean
  matchDiacritics?: boolean
  wholeWords?: boolean
  order?: BookSearchOrderDto
  /** Paging over the ordered matches — the total count is always exact. */
  offset?: number
  limit?: number
}

export interface BookSearchMatchDto {
  /** 1-based rank in reading order ("occurrence 5 of 42"), whatever the requested order. */
  occurrence: number
  /** 1-based number of the first matched word within the whole book. */
  wordIndex: number
  chunkIndex: number
  /** EPUB spine index (0 for single-flow formats) — from the chunk's `location_start`. */
  chapterIndex: number
  /** 0-based rank of this match among the matches of its chapter. */
  chapterOccurrence: number
  /** Matches in that chapter, so the renderer can verify its own count before trusting the rank. */
  chapterMatchCount: number
  /** Short context around the match, pre-split so the UI can emphasise it without HTML. */
  snippet: { before: string; match: string; after: string }
  /** FTS5 bm25() of the containing chunk — lower is more relevant. */
  score: number
}

export type BookSearchResultDto =
  | {
      state: 'ok'
      totalMatches: number
      /** Words in the whole book (denominator for "word 1,250 of 98,400"). */
      totalWords: number
      offset: number
      matches: BookSearchMatchDto[]
      hasMore: boolean
      elapsedMs: number
    }
  /** The book isn't chunked yet; a background worker was started — retry after `bookIndex:status` done. */
  | { state: 'indexing' }
  /** No text extractor for this format yet (PDF, DOCX…). */
  | { state: 'unsupported' }
  | { state: 'error'; message: string }

/** Foxit-style Word Count statistics — see `word-count-service.ts` for how each is derived from
 *  the `book_chunks` index. */
export type WordCountStatsDto =
  | {
      state: 'ok'
      words: number
      charactersWithSpaces: number
      charactersNoSpaces: number
      /** Paragraph count — the stable, index-derived analog of "lines" for reflowable text. */
      lines: number
      nonAsianWords: number
      /** CJK ideographs / Kana / Hangul, counted per character (those scripts have no spaces). */
      asianCharacters: number
    }
  /** The book isn't chunked yet; a background worker was started — retry after `bookIndex:status` done. */
  | { state: 'indexing' }
  /** No text extractor for this format yet (PDF, DOCX…). */
  | { state: 'unsupported' }
  | { state: 'error'; message: string }

export interface DesktopApi {
  ping(): Promise<'pong'>
  getAppInfo(): Promise<AppInfo>
  /** Sanitized Google OAuth client config loaded from local client_secret_*.json. */
  getGoogleOAuthConfig(): Promise<GoogleOAuthClientConfigDto | null>
  /** Update Windows/Linux caption button colors to match app theme. */
  setChromeTheme(theme: 'night' | 'sepia' | 'paper' | string): Promise<OkResult>
  /** Whether the app window is currently fullscreen. */
  getFullscreen(): Promise<boolean>
  /** Enter or leave OS-level window fullscreen. */
  setFullscreen(value: boolean): Promise<{ ok: boolean; fullscreen: boolean }>
  /** Toggle OS-level window fullscreen. */
  toggleFullscreen(): Promise<{ ok: boolean; fullscreen: boolean }>
  /**
   * Subscribe to fullscreen enter/leave (F11, Esc, button, or OS chrome).
   * Returns unsubscribe.
   */
  onFullscreenChanged(handler: (fullscreen: boolean) => void): () => void
  /**
   * Subscribe to Main's pre-close flush request (T4.2).
   * Handler should await session flush; preload acks when the promise settles.
   * Returns unsubscribe.
   */
  onRequestFlushSession(handler: () => void | Promise<void>): () => void
  /** Crops `region` from the reader window (via `webContents.capturePage`) and copies the result
   *  to the OS clipboard as an image — the Snapshot tool. Works uniformly across formats since it
   *  captures composited pixels, not the underlying DOM/canvas. */
  captureSnapshot(region: SnapshotRegionDto): Promise<OkResult>
  library: {
    listBooks(): Promise<BookSummaryDto[]>
    getBook(id: string): Promise<BookSummaryDto | null>
    openBookContent(id: string): Promise<OpenBookContentResult>
    /** After user opens Reader — book appears on Reading shelf. */
    markAsReading(id: string): Promise<OkResult>
    markAsCompleted(id: string): Promise<OkResult>
    setFavorite(id: string, value: boolean): Promise<OkResult>
    updateMetadata(input: UpdateBookMetadataInput): Promise<OkResult>
    showInFolder(id: string): Promise<OkResult>
    copyFilePath(id: string): Promise<OkResult>
    /** Remove the database record; the book file (sandbox copy or the user's own) is kept. */
    removeBook(id: string): Promise<OkResult>
    /**
     * Remove the database record and the app-owned sandbox copy. Refused (`ok: false`) for
     * `referenced` books: the user's own file is never deleted by the app.
     */
    deleteBookFile(id: string): Promise<OkResult>
    /**
     * "Locate file": Main opens a file dialog, and re-attaches the book to the chosen file only if
     * its SHA-256 matches the one recorded for `id`. Annotations, progress and search data are keyed
     * by book id, so they carry over untouched.
     */
    relinkBook(id: string): Promise<RelinkBookResult>
    listCollections(): Promise<CollectionSummaryDto[]>
    createCollection(input: {
      name: string
      description?: string
    }): Promise<CollectionSummaryDto>
    updateCollection(
      id: string,
      input: { name: string; description?: string },
    ): Promise<CollectionSummaryDto | null>
    deleteCollection(id: string): Promise<OkResult>
    addBookToCollection(collectionId: string, bookId: string): Promise<OkResult>
    removeBookFromCollection(
      collectionId: string,
      bookId: string,
    ): Promise<OkResult>
  }
  import: {
    fromFile(): Promise<ImportResult>
    fromUrl(url: string): Promise<ImportResult>
  }
  overlay: {
    getSessionState(bookId: string): Promise<ReadingSessionStateDto | null>
    saveSessionState(input: SaveReadingSessionStateInput): Promise<OkResult>
    listBookmarks(bookId: string): Promise<BookmarkDto[]>
    /** Resolves to null when the input is rejected (bad book id or unparsable locator). */
    saveBookmark(input: SaveBookmarkInput): Promise<BookmarkDto | null>
    deleteBookmark(input: DeleteBookmarkInput): Promise<OkResult>
    listHighlights(bookId: string): Promise<HighlightDto[]>
    /** Resolves to null when the input is rejected (bad book id or unparsable locator). */
    saveHighlight(input: SaveHighlightInput): Promise<HighlightDto | null>
    deleteHighlight(input: DeleteHighlightInput): Promise<OkResult>
  }
  bookIndex: {
    /** Fire-and-forget from the reader after the book is shown; never blocks on chunking. */
    ensure(bookId: string): Promise<EnsureBookIndexResult>
    /** Subscribe to background chunking status pushes. Returns unsubscribe. */
    onStatus(handler: (status: BookIndexStatusDto) => void): () => void
  }
  search: {
    /** Full-text search inside one book (FTS5 + exact occurrence counting). */
    searchBook(request: BookSearchRequestDto): Promise<BookSearchResultDto>
  }
  wordCount: {
    /** Foxit-style Words/Characters/Lines/Asian-characters breakdown, reused straight from the
     *  `book_chunks` index built for search — no separate re-scan of the book text. */
    getStats(bookId: string): Promise<WordCountStatsDto>
  }
  cloud: {
    /** Opens the provider's OAuth consent screen in a popup and stores tokens securely on success. */
    connect(provider: CloudProviderDto): Promise<CloudConnectResult>
    /** Revokes and clears the securely stored tokens for a provider. */
    disconnect(provider: CloudProviderDto): Promise<OkResult>
    /** A short-lived, auto-refreshed access token for direct provider API calls from the renderer, or null when not connected. */
    getAccessToken(provider: CloudProviderDto): Promise<string | null>
    /** Lazily downloads one catalog entry to the local sandbox and imports it like any other book. */
    downloadAndImport(
      provider: CloudProviderDto,
      entry: CloudCatalogEntryDto,
    ): Promise<CloudDownloadResult>
    /** Subscribe to byte progress for the in-flight cloud download(s). Returns unsubscribe. */
    onDownloadProgress(handler: (progress: CloudDownloadProgressDto) => void): () => void
  }
  translation: {
    /** Offline machine translation (worker thread in Main). The first use of a language pair
     *  downloads its model; progress arrives through `onProgress` under the same `requestId`. */
    translate(request: TranslateRequestDto): Promise<TranslateResultDto>
    /** Best-effort: drops a queued request; one already inferring finishes but is discarded. */
    cancel(requestId: string): Promise<void>
    /** Subscribe to model download/load progress for this window's requests. Returns unsubscribe. */
    onProgress(handler: (progress: TranslationProgressDto) => void): () => void
  }
}

export interface TranslateRequestDto {
  /** Caller-chosen id (UUID) — ties progress events and `cancel` to this request. */
  requestId: string
  text: string
  /** Catalog codes from the SDK's `TRANSLATION_LANGUAGES` (e.g. `en`, `vi`, `zh-TW`). */
  sourceLang: string
  targetLang: string
}

export type TranslationErrorCode =
  | 'NETWORK_UNAVAILABLE'
  | 'MODEL_LOAD_FAILED'
  | 'TRANSLATION_FAILED'
  | 'INVALID_ARGUMENT'
  | 'ABORTED'
  | 'UNSUPPORTED_LANGUAGE'
  | 'SAME_LANGUAGE'
  | 'WORKER_FAILED'

export type TranslateResultDto =
  | { state: 'ok'; text: string; modelId: string; durationMs: number }
  | { state: 'error'; code: TranslationErrorCode; message: string }

export interface TranslationProgressDto {
  requestId: string
  modelId: string
  /** `total` = aggregate over every model file (drive a single bar from it); `ready` = loaded. */
  status: 'initiate' | 'download' | 'progress' | 'total' | 'done' | 'ready'
  file?: string
  /** 0–100. */
  progress?: number
  loadedBytes?: number
  totalBytes?: number
}
