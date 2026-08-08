import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { Annotation, Location, type AnnotationType } from '@reading-book/domain'
import {
  getOverlayStore,
  type SessionRecord,
} from '../persistence/sqlite-overlay-store'
import type {
  AnnotationDto,
  AnnotationStyleDto,
  BookmarkDto,
  DeleteAnnotationInput,
  DeleteBookmarkInput,
  ListAnnotationsInput,
  MutationResult,
  OkResult,
  ReadingSessionStateDto,
  SaveAnnotationInput,
  SaveBookmarkInput,
  SaveReadingSessionStateInput,
  UpdateAnnotationInput,
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

function toAnnotationDto(a: Annotation): AnnotationDto {
  const dto: AnnotationDto = {
    id: a.id,
    bookId: a.bookId,
    type: a.type,
    pageNumber: a.pageNumber,
    locationData: a.locationData,
    style: { ...a.style },
    status: a.status,
    isChecked: a.isChecked,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
  if (a.content) dto.content = a.content
  return dto
}

/** Keep only clone-safe primitives so `style_properties` stays valid JSON. */
function sanitizeStyle(style: unknown): AnnotationStyleDto | undefined {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return undefined
  const out: AnnotationStyleDto = {}
  for (const [key, value] of Object.entries(style as Record<string, unknown>)) {
    if (value === undefined || value === null) continue
    const kind = typeof value
    if (kind === 'string' || kind === 'number' || kind === 'boolean') {
      out[key] = value
    }
  }
  return out
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

/** Handlers for overlay:* — session (T4.3) + annotations + bookmarks (T5.5). */
export function registerOverlayIpc(): void {
  const overlays = getOverlayStore()

  ipcMain.removeHandler(OverlayChannels.listAnnotations)
  ipcMain.handle(
    OverlayChannels.listAnnotations,
    async (_event, input: unknown): Promise<AnnotationDto[]> => {
      void _event
      if (!input || typeof input !== 'object') return []
      const body = input as ListAnnotationsInput
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) return []
      try {
        const types = Array.isArray(body.types)
          ? body.types.filter((type): type is AnnotationType =>
              Annotation.isType(type),
            )
          : undefined
        const list = await overlays.listAnnotations({
          bookId: body.bookId.trim(),
          ...(types?.length ? { types } : {}),
          ...(typeof body.pageNumber === 'number' && Number.isFinite(body.pageNumber)
            ? { pageNumber: body.pageNumber }
            : {}),
        })
        return list.map(toAnnotationDto)
      } catch {
        return []
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.saveAnnotation)
  ipcMain.handle(
    OverlayChannels.saveAnnotation,
    async (_event, input: unknown): Promise<MutationResult> => {
      void _event
      if (!input || typeof input !== 'object') return { ok: false, id: null }
      const body = input as SaveAnnotationInput
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) {
        return { ok: false, id: null }
      }
      if (!Annotation.isType(body.type)) return { ok: false, id: null }
      if (typeof body.locationData !== 'string' || !body.locationData.trim()) {
        return { ok: false, id: null }
      }
      try {
        const now = new Date().toISOString()
        const id =
          typeof body.id === 'string' && body.id.trim()
            ? body.id.trim()
            : randomUUID()
        const annotation = new Annotation({
          id,
          bookId: body.bookId.trim(),
          type: body.type,
          pageNumber: typeof body.pageNumber === 'number' ? body.pageNumber : 1,
          locationData: body.locationData.trim(),
          content: body.content,
          style: sanitizeStyle(body.style),
          status: Annotation.isStatus(body.status) ? body.status : 'None',
          isChecked: body.isChecked === true,
          createdAt: body.createdAt?.trim() || now,
          updatedAt: body.updatedAt?.trim() || now,
        })
        await overlays.saveAnnotation(annotation)
        return { ok: true, id: annotation.id }
      } catch {
        return { ok: false, id: null }
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.updateAnnotation)
  ipcMain.handle(
    OverlayChannels.updateAnnotation,
    async (_event, input: unknown): Promise<MutationResult> => {
      void _event
      if (!input || typeof input !== 'object') return { ok: false, id: null }
      const body = input as UpdateAnnotationInput
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) {
        return { ok: false, id: null }
      }
      if (typeof body.id !== 'string' || !body.id.trim()) {
        return { ok: false, id: null }
      }
      try {
        const existing = await overlays.getAnnotation(
          body.bookId.trim(),
          body.id.trim(),
        )
        if (!existing) return { ok: false, id: null }

        if (typeof body.content === 'string') existing.updateContent(body.content)
        if (typeof body.locationData === 'string' && body.locationData.trim()) {
          existing.updateLocation(
            body.locationData,
            typeof body.pageNumber === 'number' ? body.pageNumber : undefined,
          )
        } else if (typeof body.pageNumber === 'number') {
          existing.pageNumber = Annotation.normalizePageNumber(body.pageNumber)
          existing.touch()
        }
        const style = sanitizeStyle(body.style)
        if (style) existing.mergeStyle(style)
        if (Annotation.isStatus(body.status)) existing.setStatus(body.status)
        if (typeof body.isChecked === 'boolean') existing.setChecked(body.isChecked)

        await overlays.saveAnnotation(existing)
        return { ok: true, id: existing.id }
      } catch {
        return { ok: false, id: null }
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.deleteAnnotation)
  ipcMain.handle(
    OverlayChannels.deleteAnnotation,
    async (_event, input: unknown): Promise<OkResult> => {
      void _event
      if (!input || typeof input !== 'object') return { ok: false }
      const body = input as DeleteAnnotationInput
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) {
        return { ok: false }
      }
      if (typeof body.id !== 'string' || !body.id.trim()) {
        return { ok: false }
      }
      try {
        const removed = await overlays.deleteAnnotation(
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
