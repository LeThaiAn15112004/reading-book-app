import {
  Annotation,
  Bookmark,
  Location,
  ReadingSessionState,
  type AnnotationQuery,
  type AnnotationType,
  type OverlayStore,
} from '@reading-book/domain'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { getDatabase } from './db'
import {
  packSessionLocation,
  unpackSessionLocation,
} from './reading-session-location'

interface SessionRow {
  book_id: string
  last_read_location: string
  percent: number
  font_family: string | null
  font_size: number | null
  font_weight: string | null
  line_height: number | null
  text_align: string | null
  layout_mode: string | null
  page_turn_mode: string | null
  margins_enabled: number | null
  margin_preset: string | null
  is_landscape: number
  updated_at: string
}

export type SessionRecord = {
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
  pageTurnMode?: string
  marginsEnabled?: boolean
  marginPreset?: string
  isLandscape?: boolean
  updatedAt: string
}

const SESSION_COLUMNS = `
  book_id, last_read_location, percent,
  font_family, font_size, font_weight, line_height, text_align,
  layout_mode, page_turn_mode, margins_enabled, margin_preset,
  is_landscape, updated_at
`

function rowToSessionState(row: SessionRow): ReadingSessionState | undefined {
  const unpacked = unpackSessionLocation(row.last_read_location)
  if (!unpacked) return undefined

  return new ReadingSessionState({
    bookId: row.book_id,
    lastReadLocation: unpacked.location,
    lastReadLabel: unpacked.label,
    percent: row.percent,
    fontFamily: row.font_family?.trim() || undefined,
    fontSize: row.font_size != null && Number.isFinite(row.font_size)
      ? row.font_size
      : undefined,
    fontWeight: row.font_weight?.trim() || undefined,
    lineHeight: row.line_height != null && Number.isFinite(row.line_height)
      ? row.line_height
      : undefined,
    textAlign: row.text_align?.trim() || undefined,
    layoutMode: row.layout_mode?.trim() || undefined,
    pageTurnMode: row.page_turn_mode?.trim() || undefined,
    marginsEnabled: row.margins_enabled != null ? row.margins_enabled === 1 : undefined,
    marginPreset: row.margin_preset?.trim() || undefined,
    isLandscape: row.is_landscape === 1,
    updatedAt: row.updated_at,
  })
}

function rowToSessionRecord(row: SessionRow): SessionRecord {
  const unpacked = unpackSessionLocation(row.last_read_location)
  return {
    bookId: row.book_id,
    lastReadLocation: unpacked?.location.toString(),
    lastReadLabel: unpacked?.label,
    percent: row.percent,
    fontFamily: row.font_family?.trim() || undefined,
    fontSize: row.font_size != null && Number.isFinite(row.font_size)
      ? row.font_size
      : undefined,
    fontWeight: row.font_weight?.trim() || undefined,
    lineHeight: row.line_height != null && Number.isFinite(row.line_height)
      ? row.line_height
      : undefined,
    textAlign: row.text_align?.trim() || undefined,
    layoutMode: row.layout_mode?.trim() || undefined,
    pageTurnMode: row.page_turn_mode?.trim() || undefined,
    marginsEnabled: row.margins_enabled != null ? row.margins_enabled === 1 : undefined,
    marginPreset: row.margin_preset?.trim() || undefined,
    isLandscape: row.is_landscape === 1,
    updatedAt: row.updated_at,
  }
}

interface AnnotationRow {
  id: string
  book_id: string
  page_number: number
  type: string
  location_data: string
  content: string | null
  style_properties: string | null
  status: string
  is_checked: number
  created_at: string
  updated_at: string
}

const ANNOTATION_COLUMNS = `
  id, book_id, page_number, type, location_data, content,
  style_properties, status, is_checked, created_at, updated_at
`

function rowToAnnotation(row: AnnotationRow): Annotation {
  return new Annotation({
    id: row.id,
    bookId: row.book_id,
    type: Annotation.isType(row.type) ? row.type : 'highlight',
    pageNumber: row.page_number,
    locationData: row.location_data,
    content: row.content ?? undefined,
    style: Annotation.parseStyle(row.style_properties),
    status: Annotation.isStatus(row.status) ? row.status : 'None',
    isChecked: row.is_checked === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

interface BookmarkRow {
  id: string
  book_id: string
  location_ref: string
  label: string | null
  created_at: string
}

const BOOKMARK_COLUMNS = `
  id, book_id, location_ref, label, created_at
`

function rowToBookmark(row: BookmarkRow): Bookmark {
  return new Bookmark({
    id: row.id,
    bookId: row.book_id,
    locationRef: Location.parse(row.location_ref),
    label: row.label ?? undefined,
    createdAt: row.created_at,
  })
}

/**
 * SQLite OverlayStore — session (T4.3) + annotations (T5.2 / T5.10) + bookmarks (T5.5).
 */
export class SqliteOverlayStore implements OverlayStore {
  constructor(private readonly db: SqliteDatabase = getDatabase()) {}

  async getSessionState(bookId: string): Promise<ReadingSessionState | undefined> {
    const id = bookId.trim()
    if (!id) return undefined

    const row = this.db
      .prepare(
        `SELECT ${SESSION_COLUMNS}
         FROM reading_session_states WHERE book_id = ?`,
      )
      .get(id) as SessionRow | undefined

    if (!row) return undefined
    return rowToSessionState(row)
  }

  async getSessionRecord(bookId: string): Promise<SessionRecord | undefined> {
    const id = bookId.trim()
    if (!id) return undefined
    const row = this.db
      .prepare(
        `SELECT ${SESSION_COLUMNS}
         FROM reading_session_states WHERE book_id = ?`,
      )
      .get(id) as SessionRow | undefined
    return row ? rowToSessionRecord(row) : undefined
  }

  async saveSessionPreferences(record: SessionRecord): Promise<void> {
    let locationText = 'Started'
    let hasLocation = false
    if (record.lastReadLocation?.trim()) {
      try {
        locationText = packSessionLocation(
          Location.parse(record.lastReadLocation.trim()),
          record.lastReadLabel,
        )
        hasLocation = true
      } catch {
        // A settings-only save must preserve the existing location.
      }
    }
    this.db
      .prepare(
        `INSERT INTO reading_session_states (
          book_id, last_read_location, percent,
          font_family, font_size, font_weight, line_height, text_align,
          layout_mode, page_turn_mode, margins_enabled, margin_preset,
          is_landscape, updated_at
        ) VALUES (
          @book_id, @last_read_location, @percent,
          @font_family, @font_size, @font_weight, @line_height, @text_align,
          @layout_mode, @page_turn_mode, @margins_enabled, @margin_preset,
          @is_landscape, @updated_at
        )
        ON CONFLICT(book_id) DO UPDATE SET
          last_read_location = CASE
            WHEN @has_location = 1 THEN @last_read_location
            ELSE reading_session_states.last_read_location
          END,
          percent = CASE
            WHEN @has_location = 1 THEN @percent
            ELSE reading_session_states.percent
          END,
          font_family = COALESCE(@font_family, reading_session_states.font_family),
          font_size = COALESCE(@font_size, reading_session_states.font_size),
          font_weight = COALESCE(@font_weight, reading_session_states.font_weight),
          line_height = COALESCE(@line_height, reading_session_states.line_height),
          text_align = COALESCE(@text_align, reading_session_states.text_align),
          layout_mode = COALESCE(@layout_mode, reading_session_states.layout_mode),
          page_turn_mode = COALESCE(@page_turn_mode, reading_session_states.page_turn_mode),
          margins_enabled = COALESCE(@margins_enabled, reading_session_states.margins_enabled),
          margin_preset = COALESCE(@margin_preset, reading_session_states.margin_preset),
          is_landscape = CASE
            WHEN @has_landscape = 1 THEN @is_landscape
            ELSE reading_session_states.is_landscape
          END,
          updated_at = @updated_at`,
      )
      .run({
        book_id: record.bookId,
        last_read_location: locationText,
        percent: ReadingSessionState.clampPercent(record.percent),
        font_family: record.fontFamily ?? null,
        font_size: record.fontSize ?? null,
        font_weight: record.fontWeight ?? null,
        line_height: record.lineHeight ?? null,
        text_align: record.textAlign ?? null,
        layout_mode: record.layoutMode ?? null,
        page_turn_mode: record.pageTurnMode ?? null,
        margins_enabled:
          record.marginsEnabled === undefined
            ? null
            : record.marginsEnabled
              ? 1
              : 0,
        margin_preset: record.marginPreset ?? null,
        is_landscape: record.isLandscape ? 1 : 0,
        has_location: hasLocation ? 1 : 0,
        has_landscape: record.isLandscape === undefined ? 0 : 1,
        updated_at: record.updatedAt || new Date().toISOString(),
      })
  }

  async saveSessionState(s: ReadingSessionState): Promise<void> {
    const locationText = packSessionLocation(s.lastReadLocation, s.lastReadLabel)
    const percent = ReadingSessionState.clampPercent(s.percent)
    const updatedAt = s.updatedAt || new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO reading_session_states (
          book_id, last_read_location, percent,
          font_family, font_size, font_weight, line_height, text_align,
          layout_mode, page_turn_mode, margins_enabled, margin_preset,
          is_landscape, updated_at
        ) VALUES (
          @book_id, @last_read_location, @percent,
          @font_family, @font_size, @font_weight, @line_height, @text_align,
          @layout_mode, @page_turn_mode, @margins_enabled, @margin_preset,
          @is_landscape, @updated_at
        )
        ON CONFLICT(book_id) DO UPDATE SET
          last_read_location = excluded.last_read_location,
          percent = excluded.percent,
          font_family = excluded.font_family,
          font_size = excluded.font_size,
          font_weight = excluded.font_weight,
          line_height = excluded.line_height,
          text_align = excluded.text_align,
          layout_mode = excluded.layout_mode,
          page_turn_mode = excluded.page_turn_mode,
          margins_enabled = excluded.margins_enabled,
          margin_preset = excluded.margin_preset,
          is_landscape = excluded.is_landscape,
          updated_at = excluded.updated_at`,
      )
      .run({
        book_id: s.bookId,
        last_read_location: locationText,
        percent,
        font_family: s.fontFamily ?? null,
        font_size: s.fontSize ?? null,
        font_weight: s.fontWeight ?? null,
        line_height: s.lineHeight ?? null,
        text_align: s.textAlign ?? null,
        layout_mode: s.layoutMode ?? null,
        page_turn_mode: s.pageTurnMode ?? null,
        margins_enabled: s.marginsEnabled != null ? (s.marginsEnabled ? 1 : 0) : null,
        margin_preset: s.marginPreset ?? null,
        is_landscape: s.isLandscape ? 1 : 0,
        updated_at: updatedAt,
      })
  }

  async saveAnnotation(a: Annotation): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO annotations (
          id, book_id, page_number, type, location_data, content,
          style_properties, status, is_checked, created_at, updated_at
        ) VALUES (
          @id, @book_id, @page_number, @type, @location_data, @content,
          @style_properties, @status, @is_checked, @created_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          book_id = excluded.book_id,
          page_number = excluded.page_number,
          type = excluded.type,
          location_data = excluded.location_data,
          content = excluded.content,
          style_properties = excluded.style_properties,
          status = excluded.status,
          is_checked = excluded.is_checked,
          updated_at = excluded.updated_at`,
      )
      .run({
        id: a.id,
        book_id: a.bookId,
        page_number: a.pageNumber,
        type: a.type,
        location_data: a.locationData,
        content: a.content ?? null,
        style_properties: a.serializedStyle(),
        status: a.status,
        is_checked: a.isChecked ? 1 : 0,
        created_at: a.createdAt,
        updated_at: a.updatedAt,
      })
  }

  async getAnnotation(
    bookId: string,
    annotationId: string,
  ): Promise<Annotation | undefined> {
    const book = bookId.trim()
    const id = annotationId.trim()
    if (!book || !id) return undefined
    const row = this.db
      .prepare(
        `SELECT ${ANNOTATION_COLUMNS}
         FROM annotations
         WHERE book_id = ? AND id = ?`,
      )
      .get(book, id) as AnnotationRow | undefined
    return row ? rowToAnnotation(row) : undefined
  }

  async listAnnotations(query: AnnotationQuery): Promise<Annotation[]> {
    const book = query.bookId.trim()
    if (!book) return []

    const types = (query.types ?? []).filter((type): type is AnnotationType =>
      Annotation.isType(type),
    )
    // An explicit but fully invalid type filter must not silently widen to "all".
    if (query.types?.length && !types.length) return []

    const params: Array<string | number> = [book]
    let where = 'book_id = ?'
    if (types.length) {
      where += ` AND type IN (${types.map(() => '?').join(', ')})`
      params.push(...types)
    }
    if (query.pageNumber != null && Number.isFinite(query.pageNumber)) {
      where += ' AND page_number = ?'
      params.push(Math.floor(query.pageNumber))
    }

    const rows = this.db
      .prepare(
        `SELECT ${ANNOTATION_COLUMNS}
         FROM annotations
         WHERE ${where}
         ORDER BY created_at DESC`,
      )
      .all(...params) as AnnotationRow[]
    return rows.map(rowToAnnotation)
  }

  async deleteAnnotation(bookId: string, annotationId: string): Promise<boolean> {
    const book = bookId.trim()
    const id = annotationId.trim()
    if (!book || !id) return false
    const result = this.db
      .prepare(`DELETE FROM annotations WHERE book_id = ? AND id = ?`)
      .run(book, id)
    return result.changes > 0
  }

  /**
   * Persist bookmark row. `locationRef` is opaque Location JSON and may include
   * renderer extras (e.g. `chapterIndex`) ignored by Location.parse.
   */
  async saveBookmarkRecord(input: {
    id: string
    bookId: string
    locationRef: string
    label?: string
    createdAt: string
  }): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO bookmarks (
          id, book_id, location_ref, label, created_at
        ) VALUES (
          @id, @book_id, @location_ref, @label, @created_at
        )
        ON CONFLICT(id) DO UPDATE SET
          book_id = excluded.book_id,
          location_ref = excluded.location_ref,
          label = excluded.label,
          created_at = excluded.created_at`,
      )
      .run({
        id: input.id,
        book_id: input.bookId,
        location_ref: input.locationRef,
        label: input.label ?? null,
        created_at: input.createdAt,
      })
  }

  async saveBookmark(b: Bookmark): Promise<void> {
    await this.saveBookmarkRecord({
      id: b.id,
      bookId: b.bookId,
      locationRef: b.locationRef.toString(),
      label: b.label,
      createdAt: b.createdAt,
    })
  }

  async listBookmarkRecords(bookId: string): Promise<BookmarkRow[]> {
    const id = bookId.trim()
    if (!id) return []
    return this.db
      .prepare(
        `SELECT ${BOOKMARK_COLUMNS}
         FROM bookmarks
         WHERE book_id = ?
         ORDER BY created_at ASC`,
      )
      .all(id) as BookmarkRow[]
  }

  async listBookmarks(bookId: string): Promise<Bookmark[]> {
    const rows = await this.listBookmarkRecords(bookId)
    return rows.map(rowToBookmark)
  }

  async deleteBookmark(bookId: string, bookmarkId: string): Promise<boolean> {
    const book = bookId.trim()
    const id = bookmarkId.trim()
    if (!book || !id) return false
    const result = this.db
      .prepare(`DELETE FROM bookmarks WHERE book_id = ? AND id = ?`)
      .run(book, id)
    return result.changes > 0
  }
}

let overlayStore: SqliteOverlayStore | null = null

/** Singleton OverlayStore backed by the open SQLite DB. */
export function getOverlayStore(): SqliteOverlayStore {
  if (!overlayStore) {
    overlayStore = new SqliteOverlayStore()
  }
  return overlayStore
}

/** Test helper — reset singleton between isolated DB opens. */
export function resetOverlayStoreForTests(): void {
  overlayStore = null
}
