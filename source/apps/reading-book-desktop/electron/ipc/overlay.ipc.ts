import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { Highlight, Location } from '@reading-book/domain'
import {
  getOverlayStore,
  type SessionRecord,
} from '../persistence/sqlite-overlay-store'
import type {
  AddHighlightInput,
  AnnotationDto,
  BookmarkDto,
  DeleteBookmarkInput,
  DeleteHighlightInput,
  MutationResult,
  OkResult,
  ReadingSessionStateDto,
  SaveBookmarkInput,
  SaveReadingSessionStateInput,
  UpdateHighlightNoteInput,
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

function toAnnotationDto(h: Highlight): AnnotationDto {
  const dto: AnnotationDto = {
    id: h.id,
    bookId: h.bookId,
    location: h.location,
    selectedText: h.selectedText,
    colorHex: h.colorHex,
    status: h.status,
    isChecked: h.isChecked,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  }
  if (h.note) dto.note = h.note
  return dto
}

function toBookmarkDto(row: {
  id: string
  book_id: string
  location_ref: string
  label: string | null
  created_at: string
}): BookmarkDto {
  const dto: BookmarkDto = {
    id: row.id,
    bookId: row.book_id,
    locationRef: row.location_ref,
    createdAt: row.created_at,
  }
  if (row.label) dto.label = row.label
  return dto
}

/** Handlers for overlay:* — session (T4.3) + highlights + bookmarks (T5.5). */
export function registerOverlayIpc(): void {
  const overlays = getOverlayStore()

  ipcMain.removeHandler(OverlayChannels.list)
  ipcMain.handle(
    OverlayChannels.list,
    async (_event, bookId: unknown): Promise<AnnotationDto[]> => {
      void _event
      if (typeof bookId !== 'string' || !bookId.trim()) return []
      try {
        const list = await overlays.listHighlights(bookId.trim())
        return list.map(toAnnotationDto)
      } catch {
        return []
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.addHighlight)
  ipcMain.handle(
    OverlayChannels.addHighlight,
    async (_event, input: unknown): Promise<MutationResult> => {
      void _event
      if (!input || typeof input !== 'object') return { ok: false, id: null }
      const body = input as AddHighlightInput
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) {
        return { ok: false, id: null }
      }
      if (typeof body.location !== 'string' || !body.location.trim()) {
        return { ok: false, id: null }
      }
      if (typeof body.selectedText !== 'string' || !body.selectedText.trim()) {
        return { ok: false, id: null }
      }
      if (typeof body.colorHex !== 'string' || !body.colorHex.trim()) {
        return { ok: false, id: null }
      }
      try {
        const now = new Date().toISOString()
        const id =
          typeof body.id === 'string' && body.id.trim()
            ? body.id.trim()
            : randomUUID()
        const highlight = new Highlight({
          id,
          bookId: body.bookId.trim(),
          location: body.location.trim(),
          selectedText: body.selectedText,
          colorHex: body.colorHex,
          note: body.note,
          createdAt: body.createdAt?.trim() || now,
          updatedAt: body.updatedAt?.trim() || now,
        })
        await overlays.saveHighlight(highlight)
        return { ok: true, id: highlight.id }
      } catch {
        return { ok: false, id: null }
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.updateHighlightNote)
  ipcMain.handle(
    OverlayChannels.updateHighlightNote,
    async (_event, input: unknown): Promise<MutationResult> => {
      void _event
      if (!input || typeof input !== 'object') return { ok: false, id: null }
      const body = input as UpdateHighlightNoteInput
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) {
        return { ok: false, id: null }
      }
      if (typeof body.id !== 'string' || !body.id.trim()) {
        return { ok: false, id: null }
      }
      try {
        const list = await overlays.listHighlights(body.bookId.trim())
        const existing = list.find((h) => h.id === body.id.trim())
        if (!existing) return { ok: false, id: null }
        existing.updateNote(
          typeof body.note === 'string' ? body.note : '',
        )
        await overlays.saveHighlight(existing)
        return { ok: true, id: existing.id }
      } catch {
        return { ok: false, id: null }
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
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) {
        return { ok: false }
      }
      if (typeof body.id !== 'string' || !body.id.trim()) {
        return { ok: false }
      }
      try {
        const removed = await overlays.deleteHighlight(
          body.bookId.trim(),
          body.id.trim(),
        )
        return { ok: removed }
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
      try {
        const rows = await overlays.listBookmarkRecords(bookId.trim())
        return rows.map(toBookmarkDto)
      } catch {
        return []
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.saveBookmark)
  ipcMain.handle(
    OverlayChannels.saveBookmark,
    async (_event, input: unknown): Promise<MutationResult> => {
      void _event
      if (!input || typeof input !== 'object') return { ok: false, id: null }
      const body = input as SaveBookmarkInput
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) {
        return { ok: false, id: null }
      }
      if (typeof body.locationRef !== 'string' || !body.locationRef.trim()) {
        return { ok: false, id: null }
      }
      const locationRef = body.locationRef.trim()
      try {
        // Validate Location JSON (extras like chapterIndex are ignored by parse).
        Location.parse(locationRef)
        const now = new Date().toISOString()
        const id =
          typeof body.id === 'string' && body.id.trim()
            ? body.id.trim()
            : randomUUID()
        await overlays.saveBookmarkRecord({
          id,
          bookId: body.bookId.trim(),
          locationRef,
          label:
            typeof body.label === 'string' && body.label.trim()
              ? body.label.trim()
              : undefined,
          createdAt: body.createdAt?.trim() || now,
        })
        return { ok: true, id }
      } catch {
        return { ok: false, id: null }
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
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) {
        return { ok: false }
      }
      if (typeof body.id !== 'string' || !body.id.trim()) {
        return { ok: false }
      }
      try {
        const removed = await overlays.deleteBookmark(
          body.bookId.trim(),
          body.id.trim(),
        )
        return { ok: removed }
      } catch {
        return { ok: false }
      }
    },
  )

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
}
