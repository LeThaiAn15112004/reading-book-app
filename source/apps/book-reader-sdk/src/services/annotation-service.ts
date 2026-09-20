import { isValidHexColor, normalizeTags } from '../annotations/colors.js'
import { sortByDocumentOrder } from '../annotations/query.js'
import { toNoteLocator } from '../annotations/locator.js'
import { SdkError, toSdkError } from '../core/errors.js'
import type { SdkRuntime } from '../core/runtime.js'
import type { BookmarkRecord } from '../domain/annotation/bookmark.js'
import type { HighlightRecord, HighlightStyleKind } from '../domain/annotation/highlight.js'
import type { NoteSelectionText } from '../domain/annotation/note.js'
import type { Location } from '../domain/index.js'

export interface CreateMarkupInput {
  bookId: string
  styleKind: HighlightStyleKind
  location: Location
  chapterIndex: number
  colorHex?: string
  note?: string
  tags?: readonly string[]
  selectionText?: NoteSelectionText
}

export interface MarkupPatch {
  styleKind?: HighlightStyleKind
  colorHex?: string
  note?: string
  tags?: readonly string[]
}

export interface CreateBookmarkInput {
  bookId: string
  location: Location
  chapterIndex: number
  label?: string
  excerpt?: string
}

/** Use cases for highlights / underlines / strikethroughs / text notes. Stateless. */
export interface AnnotationService {
  list(bookId: string): Promise<HighlightRecord[]>
  save(input: CreateMarkupInput, existingId?: string): Promise<HighlightRecord>
  applyPatch(markup: HighlightRecord, patch: MarkupPatch): Promise<HighlightRecord>
  remove(bookId: string, id: string): Promise<boolean>
}

export interface BookmarkService {
  list(bookId: string): Promise<BookmarkRecord[]>
  save(input: CreateBookmarkInput, existingId?: string): Promise<BookmarkRecord>
  rename(bookmark: BookmarkRecord, label: string): Promise<BookmarkRecord>
  remove(bookId: string, id: string): Promise<boolean>
}

function requireBookId(bookId: string): string {
  const id = typeof bookId === 'string' ? bookId.trim() : ''
  if (!id) throw new SdkError('INVALID_ARGUMENT', 'bookId is required')
  return id
}

function cleanNote(note: string | undefined): string | undefined {
  const t = note?.trim()
  return t ? t : undefined
}

function cleanSelection(selection: NoteSelectionText | undefined): NoteSelectionText | undefined {
  if (!selection) return undefined
  const out: NoteSelectionText = {}
  if (selection.before) out.before = selection.before
  if (selection.highlight?.trim()) out.highlight = selection.highlight
  if (selection.after) out.after = selection.after
  return Object.keys(out).length > 0 ? out : undefined
}

export function createAnnotationService(rt: SdkRuntime): AnnotationService {
  const store = rt.storage.overlays

  const resolveColor = (colorHex: string | undefined): string => {
    if (colorHex === undefined) return rt.options.defaultHighlightColor
    if (!isValidHexColor(colorHex)) {
      throw new SdkError('INVALID_ARGUMENT', `Invalid color "${colorHex}" — expected #RRGGBB or #RRGGBBAA`)
    }
    return colorHex.trim()
  }

  return {
    async list(bookId) {
      const id = requireBookId(bookId)
      try {
        return sortByDocumentOrder(await store.listHighlights(id))
      } catch (err) {
        throw toSdkError(err, 'STORAGE_FAILED', 'Could not load annotations')
      }
    },

    async save(input, existingId) {
      const bookId = requireBookId(input.bookId)
      try {
        return await store.saveHighlight({
          id: existingId,
          bookId,
          locator: toNoteLocator(input.location, input.chapterIndex),
          styleKind: input.styleKind,
          colorHex: resolveColor(input.colorHex),
          note: cleanNote(input.note),
          tags: normalizeTags(input.tags),
          selectionText: cleanSelection(input.selectionText),
        })
      } catch (err) {
        throw toSdkError(err, 'STORAGE_FAILED', 'Could not save annotation')
      }
    },

    async applyPatch(markup, patch) {
      try {
        return await store.saveHighlight({
          id: markup.id,
          bookId: markup.bookId,
          locator: markup.locator,
          styleKind: patch.styleKind ?? markup.styleKind,
          colorHex: patch.colorHex !== undefined ? resolveColor(patch.colorHex) : markup.colorHex,
          note: 'note' in patch ? cleanNote(patch.note) : markup.note,
          tags: patch.tags !== undefined ? normalizeTags(patch.tags) : markup.tags,
          selectionText: markup.selectionText,
          createdAt: markup.createdAt,
        })
      } catch (err) {
        throw toSdkError(err, 'STORAGE_FAILED', 'Could not update annotation')
      }
    },

    async remove(bookId, id) {
      try {
        return await store.deleteHighlight(requireBookId(bookId), id)
      } catch (err) {
        throw toSdkError(err, 'STORAGE_FAILED', 'Could not delete annotation')
      }
    },
  }
}

export function createBookmarkService(rt: SdkRuntime): BookmarkService {
  const store = rt.storage.overlays

  return {
    async list(bookId) {
      const id = requireBookId(bookId)
      try {
        return sortByDocumentOrder(await store.listBookmarks(id))
      } catch (err) {
        throw toSdkError(err, 'STORAGE_FAILED', 'Could not load bookmarks')
      }
    },

    async save(input, existingId) {
      const bookId = requireBookId(input.bookId)
      try {
        return await store.saveBookmark({
          id: existingId,
          bookId,
          locator: toNoteLocator(input.location, input.chapterIndex),
          label: input.label?.trim() || 'Bookmark',
          excerpt: input.excerpt?.trim() || undefined,
        })
      } catch (err) {
        throw toSdkError(err, 'STORAGE_FAILED', 'Could not save bookmark')
      }
    },

    async rename(bookmark, label) {
      try {
        return await store.saveBookmark({
          id: bookmark.id,
          bookId: bookmark.bookId,
          locator: bookmark.locator,
          label: label.trim() || 'Bookmark',
          excerpt: bookmark.excerpt,
          createdAt: bookmark.createdAt,
        })
      } catch (err) {
        throw toSdkError(err, 'STORAGE_FAILED', 'Could not rename bookmark')
      }
    },

    async remove(bookId, id) {
      try {
        return await store.deleteBookmark(requireBookId(bookId), id)
      } catch (err) {
        throw toSdkError(err, 'STORAGE_FAILED', 'Could not delete bookmark')
      }
    },
  }
}
