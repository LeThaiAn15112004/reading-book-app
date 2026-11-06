/**
 * `overlay.*` (spec 008, T059). Same validation and DTOs as Desktop's `overlay.ipc.ts`, with Mobile's limits on
 * what is created: text markup only (`MOBILE_WRITABLE_STYLE_KINDS`), no TXT rows (TXT is read-only in the first
 * release, and on Desktop TXT rows are written only by `txt:commit`). A rejected save resolves to `null`, as on
 * Desktop. PDF ink and the PDF file sync do not exist on Mobile: their reads are safe empty results.
 */
import { parseMdAnnotationRef, parsePdfAnnotationRef, type MdAnnotation, type PdfAnnotation } from '@core'
import { MOBILE_WRITABLE_STYLE_KINDS } from '../stores/overlay-store'
import { idOf, type BridgeContext } from './context'
import { parseLocatorRef, parseSelectionTextRef, toBookmarkDto, toHighlightDto, toSessionDto } from './dto'
import { noEvents, notAvailable, notAvailableResult } from './unavailable'

type Overlay = Window['api']['overlay']

export function createOverlayGroup(ctx: BridgeContext): Overlay {
  const { overlay, writes } = ctx

  return {
    async getSessionState(bookId) {
      const id = idOf(bookId)
      const state = id ? await overlay.getSessionRecord(id) : undefined
      return state ? toSessionDto(state) : null
    },

    saveSessionState: (input) =>
      writes.run(async () => {
        const body = (input && typeof input === 'object' ? input : {}) as Partial<Parameters<Overlay['saveSessionState']>[0]>
        const bookId = idOf(body.bookId)
        if (!bookId) return { ok: false }
        const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
        const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
        try {
          const ok = await overlay.saveSessionPreferences({
            bookId,
            lastReadLocation: text(body.lastReadLocation),
            lastReadLabel: typeof body.lastReadLabel === 'string' ? body.lastReadLabel : undefined,
            percent: finite(body.percent) ?? 0,
            fontFamily: text(body.fontFamily),
            fontSize: finite(body.fontSize),
            fontWeight: text(body.fontWeight),
            lineHeight: finite(body.lineHeight),
            textAlign: text(body.textAlign),
            layoutMode: text(body.layoutMode),
            pageTurnMode: text(body.pageTurnMode),
            marginsEnabled: typeof body.marginsEnabled === 'boolean' ? body.marginsEnabled : undefined,
            marginPreset: text(body.marginPreset),
            isLandscape: typeof body.isLandscape === 'boolean' ? body.isLandscape : undefined,
            updatedAt: text(body.updatedAt) ?? new Date().toISOString(),
          })
          return { ok }
        } catch {
          return { ok: false }
        }
      }),

    async listBookmarks(bookId) {
      const id = idOf(bookId)
      return id ? (await overlay.listBookmarks(id)).map(toBookmarkDto) : []
    },

    saveBookmark: (input) =>
      writes.run(async () => {
        const body = (input && typeof input === 'object' ? input : {}) as Partial<Parameters<Overlay['saveBookmark']>[0]>
        const bookId = idOf(body.bookId)
        const locator = parseLocatorRef(body.locatorRef)
        if (!bookId || !locator) return null
        try {
          const saved = await overlay.saveBookmark({
            id: idOf(body.id),
            bookId,
            locator,
            label: idOf(body.label),
            excerpt: idOf(body.excerpt),
            createdAt: idOf(body.createdAt),
          })
          return toBookmarkDto(saved)
        } catch {
          return null
        }
      }),

    deleteBookmark: (input) =>
      writes.run(async () => {
        const body = (input && typeof input === 'object' ? input : {}) as { bookId?: unknown; id?: unknown }
        if (typeof body.bookId !== 'string' || typeof body.id !== 'string') return { ok: false }
        try {
          return { ok: await overlay.deleteBookmark(body.bookId, body.id) }
        } catch {
          return { ok: false }
        }
      }),

    async listHighlights(bookId) {
      const id = idOf(bookId)
      return id ? (await overlay.listHighlights(id)).map(toHighlightDto) : []
    },

    saveHighlight: (input) =>
      writes.run(async () => {
        const body = (input && typeof input === 'object' ? input : {}) as Partial<Parameters<Overlay['saveHighlight']>[0]>
        const bookId = idOf(body.bookId)
        const locator = parseLocatorRef(body.locatorRef)
        if (!bookId || !locator) return null
        // TXT is read-only on Mobile; Desktop also refuses TXT rows here (they belong to txt:commit).
        if (body.txtAnnotationRef !== undefined) return null
        if (!body.styleKind || !MOBILE_WRITABLE_STYLE_KINDS.includes(body.styleKind)) return null
        if (typeof body.colorHex !== 'string' || !body.colorHex.trim()) return null
        let pdfAnnotation: PdfAnnotation | undefined
        if (body.pdfAnnotationRef !== undefined) {
          pdfAnnotation = parsePdfAnnotationRef(body.pdfAnnotationRef, body.note)
          if (!pdfAnnotation) return null
        }
        let mdAnnotation: MdAnnotation | undefined
        if (body.mdAnnotationRef !== undefined) {
          mdAnnotation = parseMdAnnotationRef(body.mdAnnotationRef)
          if (!mdAnnotation) return null
        }
        try {
          // The store re-validates (page agreement, Markdown anchor, no shapes / typewriter / attachments).
          const saved = await overlay.saveHighlight({
            id: idOf(body.id),
            bookId,
            locator,
            styleKind: body.styleKind,
            colorHex: body.colorHex.trim(),
            note: idOf(body.note),
            tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : undefined,
            selectionText: parseSelectionTextRef(body.selectionTextRef),
            pdfAnnotation,
            mdAnnotation,
            createdAt: idOf(body.createdAt),
          })
          return toHighlightDto(saved)
        } catch {
          return null
        }
      }),

    deleteHighlight: (input) =>
      writes.run(async () => {
        const body = (input && typeof input === 'object' ? input : {}) as { bookId?: unknown; id?: unknown }
        if (typeof body.bookId !== 'string' || typeof body.id !== 'string') return { ok: false }
        try {
          return { ok: await overlay.deleteHighlight(body.bookId, body.id) }
        } catch {
          return { ok: false }
        }
      }),

    // Safe empty results: the Reader calls these while a PDF is open.
    listInk: async () => [],
    listPdfAnnotationConflicts: async () => [],
    watchPdfEmbeddedAnnotations: async () => ({ ok: true }),
    unwatchPdfEmbeddedAnnotations: async () => ({ ok: true }),
    onPdfEmbeddedAnnotationsChanged: noEvents,

    getAudioProgress: notAvailable('overlay.getAudioProgress'),
    saveAudioProgress: notAvailable('overlay.saveAudioProgress'),
    saveInk: notAvailable('overlay.saveInk'),
    deleteInk: notAvailable('overlay.deleteInk'),
    exportAnnotatedPdf: notAvailableResult('overlay.exportAnnotatedPdf'),
    confirmSignedPdfWrite: notAvailable('overlay.confirmSignedPdfWrite'),
    resolvePdfAnnotationConflict: notAvailableResult('overlay.resolvePdfAnnotationConflict'),
  }
}
