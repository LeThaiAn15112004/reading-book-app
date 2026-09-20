/**
 * Electron RENDERER — a `StorageAdapter` that forwards to the EXISTING `window.api.overlay` IPC
 * surface (DTO shapes copied from `electron/ipc/api-types.ts`). The renderer still never sees a
 * filesystem path or SQLite; the SDK stores just gain a storage backend.
 */
import {
  SdkError,
  packLocator,
  sanitizeReadingPrefs,
  serializeLocation,
  tryParseLocation,
  unpackLocator,
  type Bookmark,
  type LibraryRepository,
  type MarkupAnnotation,
  type MarkupKind,
  type ReadingSession,
  type SelectionText,
  type StorageAdapter,
} from '../../../dist/index.mjs'

// ── DTO subset of electron/ipc/api-types.ts ──────────────────────────────────────────────────
interface OkResult {
  ok: boolean
}
interface HighlightDto {
  id: string
  bookId: string
  locatorRef: string
  styleKind: MarkupKind
  colorHex: string
  note?: string
  tags: string[]
  selectionTextRef?: string
  createdAt: string
  updatedAt: string
}
interface BookmarkDto {
  id: string
  bookId: string
  locatorRef: string
  label?: string
  excerpt?: string
  createdAt: string
}
interface ReadingSessionStateDto {
  bookId: string
  lastReadLocation?: string
  lastReadLabel?: string
  percent: number
  fontFamily?: string
  fontSize?: number
  fontWeight?: string
  lineHeight?: number
  textAlign?: string
  layoutMode?: string
  marginsEnabled?: boolean
  marginPreset?: string
  isLandscape?: boolean
  updatedAt: string
}
type SaveReadingSessionStateInput = Partial<Omit<ReadingSessionStateDto, 'bookId'>> & { bookId: string }

export interface OverlayBridge {
  getSessionState(bookId: string): Promise<ReadingSessionStateDto | null>
  saveSessionState(input: SaveReadingSessionStateInput): Promise<OkResult>
  listBookmarks(bookId: string): Promise<BookmarkDto[]>
  saveBookmark(input: Omit<BookmarkDto, 'createdAt'> & { createdAt?: string }): Promise<BookmarkDto | null>
  deleteBookmark(input: { bookId: string; id: string }): Promise<OkResult>
  listHighlights(bookId: string): Promise<HighlightDto[]>
  saveHighlight(
    input: Omit<HighlightDto, 'updatedAt' | 'createdAt'> & { createdAt?: string },
  ): Promise<HighlightDto | null>
  deleteHighlight(input: { bookId: string; id: string }): Promise<OkResult>
}

function parseSelection(raw: string | undefined): SelectionText | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as SelectionText
  } catch {
    return undefined
  }
}

function ipcFailed(operation: string): never {
  throw new SdkError('STORAGE_FAILED', `IPC ${operation} was rejected by the main process`)
}

/** Library writes need fs + hashing → they stay in the main process SDK instance. */
const mainProcessOnlyLibrary: LibraryRepository = {
  listBooks: () => Promise.reject(new SdkError('ADAPTER_MISSING', 'library is served by the main process')),
  getBook: () => Promise.reject(new SdkError('ADAPTER_MISSING', 'library is served by the main process')),
  findBySha256: () => Promise.reject(new SdkError('ADAPTER_MISSING', 'library is served by the main process')),
  saveBook: () => Promise.reject(new SdkError('ADAPTER_MISSING', 'library is served by the main process')),
  deleteBook: () => Promise.reject(new SdkError('ADAPTER_MISSING', 'library is served by the main process')),
}

export function createIpcStorage(overlay: OverlayBridge): StorageAdapter {
  return {
    library: mainProcessOnlyLibrary,

    annotations: {
      async listMarkups(bookId) {
        const rows = await overlay.listHighlights(bookId)
        return rows.flatMap((dto): MarkupAnnotation[] => {
          const anchor = unpackLocator(dto.locatorRef)
          if (!anchor) return [] // stale row that could never render/jump — drop it
          const markup: MarkupAnnotation = {
            id: dto.id,
            bookId: dto.bookId,
            kind: dto.styleKind,
            ...anchor,
            colorHex: dto.colorHex,
            tags: dto.tags ?? [],
            createdAt: dto.createdAt,
            updatedAt: dto.updatedAt,
          }
          if (dto.note) markup.note = dto.note
          const selectionText = parseSelection(dto.selectionTextRef)
          if (selectionText) markup.selectionText = selectionText
          return [markup]
        })
      },
      async saveMarkup(m) {
        const saved = await overlay.saveHighlight({
          id: m.id,
          bookId: m.bookId,
          locatorRef: packLocator(m.location, m.chapterIndex),
          styleKind: m.kind,
          colorHex: m.colorHex,
          tags: m.tags,
          createdAt: m.createdAt,
          ...(m.note ? { note: m.note } : {}),
          ...(m.selectionText ? { selectionTextRef: JSON.stringify(m.selectionText) } : {}),
        })
        if (!saved) ipcFailed('saveHighlight')
      },
      deleteMarkup: async (bookId, id) => (await overlay.deleteHighlight({ bookId, id })).ok,
    },

    bookmarks: {
      async listBookmarks(bookId) {
        const rows = await overlay.listBookmarks(bookId)
        return rows.flatMap((dto): Bookmark[] => {
          const anchor = unpackLocator(dto.locatorRef)
          if (!anchor) return []
          const bookmark: Bookmark = {
            id: dto.id,
            bookId: dto.bookId,
            ...anchor,
            label: dto.label?.trim() || 'Bookmark',
            createdAt: dto.createdAt,
            updatedAt: dto.createdAt, // BookmarkDto has no updatedAt
          }
          if (dto.excerpt) bookmark.excerpt = dto.excerpt
          return [bookmark]
        })
      },
      async saveBookmark(b) {
        const saved = await overlay.saveBookmark({
          id: b.id,
          bookId: b.bookId,
          locatorRef: packLocator(b.location, b.chapterIndex),
          label: b.label,
          createdAt: b.createdAt,
          ...(b.excerpt ? { excerpt: b.excerpt } : {}),
        })
        if (!saved) ipcFailed('saveBookmark')
      },
      deleteBookmark: async (bookId, id) => (await overlay.deleteBookmark({ bookId, id })).ok,
    },

    sessions: {
      async getSession(bookId) {
        const dto = await overlay.getSessionState(bookId)
        if (!dto) return null
        const session: ReadingSession = {
          bookId,
          percent: dto.percent,
          prefs: sanitizeReadingPrefs({
            fontFamily: dto.fontFamily,
            fontSize: dto.fontSize,
            fontWeight: dto.fontWeight,
            lineHeight: dto.lineHeight,
            textAlign: dto.textAlign,
            layout: dto.layoutMode,
            marginEnabled: dto.marginsEnabled,
            margin: dto.marginPreset,
            isLandscape: dto.isLandscape,
          }),
          updatedAt: dto.updatedAt,
        }
        const location = tryParseLocation(dto.lastReadLocation)
        if (location) session.location = location
        if (dto.lastReadLabel) session.locationLabel = dto.lastReadLabel
        return session
      },
      async saveSession(s) {
        const p = s.prefs
        const result = await overlay.saveSessionState({
          bookId: s.bookId,
          percent: s.percent,
          updatedAt: s.updatedAt,
          ...(s.location ? { lastReadLocation: serializeLocation(s.location) } : {}),
          ...(s.locationLabel ? { lastReadLabel: s.locationLabel } : {}),
          ...(p.fontFamily ? { fontFamily: p.fontFamily } : {}),
          ...(p.fontSize != null ? { fontSize: p.fontSize } : {}),
          ...(p.fontWeight != null ? { fontWeight: String(p.fontWeight) } : {}),
          ...(p.lineHeight != null ? { lineHeight: p.lineHeight } : {}),
          ...(p.textAlign ? { textAlign: p.textAlign } : {}),
          ...(p.layout ? { layoutMode: p.layout } : {}),
          ...(p.marginEnabled != null ? { marginsEnabled: p.marginEnabled } : {}),
          ...(p.margin ? { marginPreset: p.margin } : {}),
          ...(p.isLandscape != null ? { isLandscape: p.isLandscape } : {}),
        })
        if (!result.ok) ipcFailed('saveSessionState')
      },
    },
  }
}
