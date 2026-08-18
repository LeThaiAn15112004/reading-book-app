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
  /** Genre / subject names (from book_genres). */
  genres?: string[]
  /** Page or spine-section count when known. */
  pageCount?: number
  isFavorite?: boolean
  readingStatus?: ReadingStatusDto
  /** Human-readable last-read location; when set, enables Continue Reading. */
  lastReadLocation?: string
  lastReadAt?: string
  noteCount?: number
}

export interface OkResult {
  ok: boolean
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
 * Main resolves `books.file_path` under the sandbox allowlist.
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

export interface MutationResult {
  ok: boolean
  id: string | null
}

export type AnnotationTypeDto =
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'freehand'
  | 'textbox'
  | 'stamp'

export type AnnotationStatusDto = 'None' | 'Review' | 'Done'

/** Presentation attributes (`style_properties` JSON) — keys vary by type. */
export interface AnnotationStyleDto {
  colorHex?: string
  strokeWidth?: number
  opacity?: number
  fontFamily?: string
  fontSize?: number
  /** Inline note written against a markup annotation. */
  note?: string
  [key: string]: unknown
}

/** Clone-safe annotation row for IPC (`annotations` table). */
export interface AnnotationDto {
  id: string
  bookId: string
  type: AnnotationTypeDto
  /** 1-based page; reflowable formats anchor on `locationData` and use 1. */
  pageNumber: number
  /** Opaque per-type location: packed `start|end` Location, CFI, or JSON geometry. */
  locationData: string
  content?: string
  style: AnnotationStyleDto
  status: AnnotationStatusDto
  isChecked: boolean
  createdAt: string
  updatedAt: string
}

export interface BookmarkDto {
  id: string
  bookId: string
  /** Location.toString() JSON; may include renderer `chapterIndex` extra. */
  locationRef: string
  label?: string
  createdAt: string
}

export interface SaveBookmarkInput {
  bookId: string
  id?: string
  /** Location JSON (optionally with `chapterIndex` for ribbon matching). */
  locationRef: string
  label?: string
  createdAt?: string
}

export interface DeleteBookmarkInput {
  bookId: string
  id: string
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

/** Filter for overlay:listAnnotations; omitted fields mean "any". */
export interface ListAnnotationsInput {
  bookId: string
  types?: AnnotationTypeDto[]
  pageNumber?: number
}

export interface SaveAnnotationInput {
  bookId: string
  id?: string
  type: AnnotationTypeDto
  pageNumber?: number
  locationData: string
  content?: string
  style?: AnnotationStyleDto
  status?: AnnotationStatusDto
  isChecked?: boolean
  createdAt?: string
  updatedAt?: string
}

/** Partial patch — omitted fields keep their stored value. `style` merges. */
export interface UpdateAnnotationInput {
  bookId: string
  id: string
  content?: string
  /** Opaque per-type location (e.g. typewriter `{xPct,yPct}` JSON). */
  locationData?: string
  pageNumber?: number
  style?: AnnotationStyleDto
  status?: AnnotationStatusDto
  isChecked?: boolean
}

export interface DeleteAnnotationInput {
  bookId: string
  id: string
}

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
    /** Remove the database record but keep the imported sandbox file. */
    removeBook(id: string): Promise<OkResult>
    /** Remove the database record and its imported sandbox file. */
    deleteBookFile(id: string): Promise<OkResult>
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
    listAnnotations(input: ListAnnotationsInput): Promise<AnnotationDto[]>
    saveAnnotation(input: SaveAnnotationInput): Promise<MutationResult>
    updateAnnotation(input: UpdateAnnotationInput): Promise<MutationResult>
    deleteAnnotation(input: DeleteAnnotationInput): Promise<OkResult>
    listBookmarks(bookId: string): Promise<BookmarkDto[]>
    saveBookmark(input: SaveBookmarkInput): Promise<MutationResult>
    deleteBookmark(input: DeleteBookmarkInput): Promise<OkResult>
    getSessionState(bookId: string): Promise<ReadingSessionStateDto | null>
    saveSessionState(input: SaveReadingSessionStateInput): Promise<OkResult>
  }
}
