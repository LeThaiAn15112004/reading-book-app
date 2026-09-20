import {
  Location,
  type BookmarkRecord,
  type HighlightRecord,
  type NoteLocator,
  type NoteSelectionText,
} from '@reading-book/book-reader-sdk'
import { ipcMain } from 'electron'
import {
  getOverlayStore,
  type SessionRecord,
} from '../persistence/sqlite-overlay-store'
import type {
  BookmarkDto,
  DeleteBookmarkInput,
  DeleteHighlightInput,
  HighlightDto,
  OkResult,
  ReadingSessionStateDto,
  SaveBookmarkInput,
  SaveHighlightInput,
  SaveReadingSessionStateInput,
} from './api-types'
import { OverlayChannels } from './channels'

function toSessionDto(state: SessionRecord): ReadingSessionStateDto {
  const dto: ReadingSessionStateDto = {
    bookId: state.bookId,
    percent: state.percent,
    isLandscape: state.isLandscape,
    updatedAt: state.updatedAt,
  }
  if (state.lastReadLocation) dto.lastReadLocation = state.lastReadLocation
  if (state.lastReadLabel) dto.lastReadLabel = state.lastReadLabel
  if (state.fontFamily) dto.fontFamily = state.fontFamily
  if (state.fontSize != null) dto.fontSize = state.fontSize
  if (state.fontWeight) dto.fontWeight = state.fontWeight
  if (state.lineHeight != null) dto.lineHeight = state.lineHeight
  if (state.textAlign) dto.textAlign = state.textAlign
  if (state.layoutMode) dto.layoutMode = state.layoutMode
  if (state.pageTurnMode) dto.pageTurnMode = state.pageTurnMode
  if (state.marginsEnabled != null) dto.marginsEnabled = state.marginsEnabled
  if (state.marginPreset) dto.marginPreset = state.marginPreset
  return dto
}

function inputToSessionRecord(input: SaveReadingSessionStateInput): SessionRecord {
  return {
    bookId: input.bookId.trim(),
    lastReadLocation: input.lastReadLocation?.trim() || undefined,
    lastReadLabel: input.lastReadLabel,
    percent: input.percent ?? 0,
    fontFamily: input.fontFamily?.trim() || undefined,
    fontSize: input.fontSize != null && Number.isFinite(input.fontSize)
      ? input.fontSize
      : undefined,
    fontWeight: input.fontWeight?.trim() || undefined,
    lineHeight: input.lineHeight != null && Number.isFinite(input.lineHeight)
      ? input.lineHeight
      : undefined,
    textAlign: input.textAlign?.trim() || undefined,
    layoutMode: input.layoutMode?.trim() || undefined,
    pageTurnMode: input.pageTurnMode?.trim() || undefined,
    marginsEnabled: input.marginsEnabled,
    marginPreset: input.marginPreset?.trim() || undefined,
    isLandscape: input.isLandscape,
    updatedAt: input.updatedAt?.trim() || new Date().toISOString(),
  }
}

function toBookmarkDto(bookmark: BookmarkRecord): BookmarkDto {
  const dto: BookmarkDto = {
    id: bookmark.id,
    bookId: bookmark.bookId,
    locatorRef: JSON.stringify(bookmark.locator),
    createdAt: bookmark.createdAt,
  }
  if (bookmark.label) dto.label = bookmark.label
  if (bookmark.excerpt) dto.excerpt = bookmark.excerpt
  return dto
}

function toHighlightDto(highlight: HighlightRecord): HighlightDto {
  const dto: HighlightDto = {
    id: highlight.id,
    bookId: highlight.bookId,
    locatorRef: JSON.stringify(highlight.locator),
    styleKind: highlight.styleKind,
    colorHex: highlight.colorHex,
    tags: highlight.tags,
    createdAt: highlight.createdAt,
    updatedAt: highlight.updatedAt,
  }
  if (highlight.note) dto.note = highlight.note
  if (highlight.selectionText) dto.selectionTextRef = JSON.stringify(highlight.selectionText)
  return dto
}

/**
 * Decodes a renderer-supplied locator string. Returns undefined when it is not a valid
 * `Location` JSON, so a malformed bookmark is rejected at the boundary instead of being stored
 * and only failing later, at jump time, when it can no longer be traced back to its origin.
 */
function parseLocatorRef(raw: unknown): NoteLocator | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  try {
    // Location.parse validates `kind` and its required fields; extras like `chapterIndex`
    // ride along in the JSON untouched.
    Location.parse(raw)
    return JSON.parse(raw) as NoteLocator
  } catch {
    return undefined
  }
}

/** Parses the JSON `{before?, highlight?, after?}` blob a highlight's selection carries. */
function parseSelectionTextRef(raw: unknown): NoteSelectionText | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  try {
    return JSON.parse(raw) as NoteSelectionText
  } catch {
    return undefined
  }
}

/**
 * Handlers for overlay:* — reading session state (T4.3), bookmarks (FR-11), and highlights.
 */
export function registerOverlayIpc(): void {
  const overlays = getOverlayStore()

  ipcMain.removeHandler(OverlayChannels.getSessionState)
  ipcMain.handle(
    OverlayChannels.getSessionState,
    async (_event, bookId: unknown): Promise<ReadingSessionStateDto | null> => {
      void _event
      if (typeof bookId !== 'string' || !bookId.trim()) return null
      const state = await overlays.getSessionRecord(bookId.trim())
      return state ? toSessionDto(state) : null
    },
  )

  ipcMain.removeHandler(OverlayChannels.saveSessionState)
  ipcMain.handle(
    OverlayChannels.saveSessionState,
    async (_event, input: unknown): Promise<OkResult> => {
      void _event
      if (!input || typeof input !== 'object') return { ok: false }
      const body = input as SaveReadingSessionStateInput
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) return { ok: false }
      try {
        const state = inputToSessionRecord(body)
        await overlays.saveSessionPreferences(state)
        return { ok: true }
      } catch {
        return { ok: false }
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.listBookmarks)
  ipcMain.handle(
    OverlayChannels.listBookmarks,
    async (_event, bookId: unknown): Promise<BookmarkDto[]> => {
      void _event
      if (typeof bookId !== 'string' || !bookId.trim()) return []
      const bookmarks = await overlays.listBookmarks(bookId.trim())
      return bookmarks.map(toBookmarkDto)
    },
  )

  ipcMain.removeHandler(OverlayChannels.saveBookmark)
  ipcMain.handle(
    OverlayChannels.saveBookmark,
    async (_event, input: unknown): Promise<BookmarkDto | null> => {
      void _event
      if (!input || typeof input !== 'object') return null
      const body = input as SaveBookmarkInput
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) return null

      const locator = parseLocatorRef(body.locatorRef)
      if (!locator) return null

      try {
        const saved = await overlays.saveBookmark({
          id: body.id?.trim() || undefined,
          bookId: body.bookId.trim(),
          locator,
          label: body.label?.trim() || undefined,
          excerpt: body.excerpt?.trim() || undefined,
          createdAt: body.createdAt?.trim() || undefined,
        })
        return toBookmarkDto(saved)
      } catch {
        return null
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.deleteBookmark)
  ipcMain.handle(
    OverlayChannels.deleteBookmark,
    async (_event, input: unknown): Promise<OkResult> => {
      void _event
      if (!input || typeof input !== 'object') return { ok: false }
      const body = input as DeleteBookmarkInput
      if (typeof body.bookId !== 'string' || typeof body.id !== 'string') {
        return { ok: false }
      }
      try {
        const ok = await overlays.deleteBookmark(body.bookId, body.id)
        return { ok }
      } catch {
        return { ok: false }
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.listHighlights)
  ipcMain.handle(
    OverlayChannels.listHighlights,
    async (_event, bookId: unknown): Promise<HighlightDto[]> => {
      void _event
      if (typeof bookId !== 'string' || !bookId.trim()) return []
      const highlights = await overlays.listHighlights(bookId.trim())
      return highlights.map(toHighlightDto)
    },
  )

  ipcMain.removeHandler(OverlayChannels.saveHighlight)
  ipcMain.handle(
    OverlayChannels.saveHighlight,
    async (_event, input: unknown): Promise<HighlightDto | null> => {
      void _event
      if (!input || typeof input !== 'object') return null
      const body = input as SaveHighlightInput
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) return null

      const locator = parseLocatorRef(body.locatorRef)
      if (!locator) return null
      const validStyleKinds = ['highlight', 'underline', 'strikethrough', 'textbox']
      if (!validStyleKinds.includes(body.styleKind)) return null
      if (typeof body.colorHex !== 'string' || !body.colorHex.trim()) return null

      try {
        const saved = await overlays.saveHighlight({
          id: body.id?.trim() || undefined,
          bookId: body.bookId.trim(),
          locator,
          styleKind: body.styleKind,
          colorHex: body.colorHex.trim(),
          note: body.note?.trim() || undefined,
          tags: body.tags,
          selectionText: parseSelectionTextRef(body.selectionTextRef),
          createdAt: body.createdAt?.trim() || undefined,
        })
        return toHighlightDto(saved)
      } catch {
        return null
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.deleteHighlight)
  ipcMain.handle(
    OverlayChannels.deleteHighlight,
    async (_event, input: unknown): Promise<OkResult> => {
      void _event
      if (!input || typeof input !== 'object') return { ok: false }
      const body = input as DeleteHighlightInput
      if (typeof body.bookId !== 'string' || typeof body.id !== 'string') {
        return { ok: false }
      }
      try {
        const ok = await overlays.deleteHighlight(body.bookId, body.id)
        return { ok }
      } catch {
        return { ok: false }
      }
    },
  )
}
