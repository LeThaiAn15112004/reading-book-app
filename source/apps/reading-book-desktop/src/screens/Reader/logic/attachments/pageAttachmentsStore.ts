import { create } from 'zustand'
import {
  classifyAttachment,
  describeAttachFailure,
  describeAttachmentBlock,
  formatAttachmentSize,
  highlightReplace,
  pdfHighlightDtoToReaderHighlight,
  type HighlightAction,
  readmateAttachmentId,
  type PdfReaderHighlight,
} from '@reading-book/book-reader-sdk'
import { attachmentsApi } from '../../../../bridge/attachments'
import { overlayApi } from '../../../../bridge/overlay'
import type { PdfAttachmentPin } from '../../../../reader/renderers/pdf'
import { registerAttachmentHistory, usePdfHighlightsStore } from '../pdfHighlights/pdfHighlightsStore'

type SyncEvent = Parameters<Parameters<typeof overlayApi.onPdfEmbeddedAnnotationsChanged>[0]>[0]
export type ForeignPageAttachment = NonNullable<SyncEvent['pageAttachments']>[number]

/**
 * Page file attachments of the open PDF (specs/007-pdf-file-attachment): placing a new one with the File
 * Attachment tool, selecting an icon, its details panel and the open / Save As flow. Main owns the picker, the
 * file and the PDF; the renderer sends a book, a page and a point, or a book and an attachment id — never a path,
 * a name or bytes. A Readmate-made attachment is an ordinary row (style kind `attachment`) of `pdfHighlightsStore`
 * once the file holds it; attachments other readers made come with each sync event (`foreign`).
 */
type PageAttachmentsState = {
  bookId: string | null
  /** An attach is running (picker open or the PDF being written): one at a time. */
  creating: boolean
  /** Page attachments made by other readers (open / save only). */
  foreign: ForeignPageAttachment[]
  /** The selected icon (single click). */
  selectedId: string | null
  /** The details panel (double-click / Enter / context menu "Details"). */
  details: PdfAttachmentPin | null
  /** The right-click menu of an icon, at client coordinates. */
  menu: { pin: PdfAttachmentPin; x: number; y: number } | null
  /** The "Open attachment?" confirmation. */
  confirming: PdfAttachmentPin | null
  /** "Readmate can't open this file" with Save As. */
  blocked: { pin: PdfAttachmentPin; message: string } | null
  /** An open / save is in flight: at most one. */
  busy: boolean
  /** A move is being written: the icon is shown dimmed at `box` until Main answers (then the file's place). */
  moving: { id: string; box: Box } | null
  /** A move / delete is in flight: at most one. */
  changing: boolean
  /** The delete confirmation. */
  deleting: PdfAttachmentPin | null
  /**
   * A digitally signed PDF: writing makes readers report the signature as modified, so the request waits for the
   * user (FR-012). On confirm Main is told once (`overlay:confirmSignedPdfWrite`) and `retry` repeats the request
   * — the picker opens only then for an attach; on decline nothing is written.
   */
  signed: { bookId: string; signerName?: string; retry: () => void } | null
  /**
   * Why this PDF cannot be written at all, as the sync or an attach / move / delete last found it (read-only,
   * Readmate's own copy, encrypted, unsupported) — the File Attachment tool is shown disabled with it (FR-012).
   * Null when writable or not known. A signed PDF is not "blocked": the user may confirm.
   */
  writeBlocked: string | null
  setBook: (bookId: string | null) => void
  applySync: (event: SyncEvent) => void
  create: (bookId: string, pageIndex: number, point: { x: number; y: number }) => Promise<void>
  select: (id: string | null) => void
  showDetails: (pin: PdfAttachmentPin) => void
  closeDetails: () => void
  openMenu: (pin: PdfAttachmentPin, x: number, y: number) => void
  closeMenu: () => void
  requestOpen: (pin: PdfAttachmentPin) => void
  cancelOpen: () => void
  confirmOpen: () => Promise<void>
  saveAs: (pin: PdfAttachmentPin) => Promise<void>
  dismissBlocked: () => void
  /** Drag-to-move of a Readmate-made attachment (same page, same size): ONE history entry on success. */
  move: (rowId: string, box: Box) => Promise<void>
  requestDelete: (pin: PdfAttachmentPin) => void
  cancelDelete: () => void
  confirmDelete: () => Promise<void>
  /** Delete without asking (the confirmation already happened). Not in the history (research R13). */
  remove: (rowId: string) => Promise<boolean>
  confirmSigned: () => Promise<void>
  declineSigned: () => void
}

type Box = { x: number; y: number; width: number; height: number }

/** The id attachments:open / saveAs take for a pin (contracts §4). */
export function attachmentIdOfPin(pin: PdfAttachmentPin): string {
  return pin.editable ? readmateAttachmentId(pin.id) : pin.id
}

/**
 * Can Readmate hand this file to the OS, judging by its name alone? (Main checks the name AND the content again;
 * this only decides whether Open is offered at all — FR-016.)
 */
export function openBlockedByName(pin: PdfAttachmentPin): string | null {
  const verdict = classifyAttachment(pin.name, new Uint8Array(0))
  return verdict.open ? null : describeAttachmentBlock(verdict.reason)
}

const toast = (message: string) => usePdfHighlightsStore.getState().onToast(message)

const IDLE = {
  creating: false,
  foreign: [],
  selectedId: null,
  details: null,
  menu: null,
  confirming: null,
  blocked: null,
  busy: false,
  moving: null,
  changing: false,
  deleting: null,
  signed: null,
  writeBlocked: null,
}

/** Write refusals that last until the file itself changes (not `signed`, `locked`, `changed`). */
const LASTING_BLOCKS = new Set(['read_only', 'managed_copy', 'encrypted', 'unsupported_pdf'])

/** The disabled tool's reason for a lasting block, or null. */
function lastingBlock(reason: string | undefined): string | null {
  return reason && LASTING_BLOCKS.has(reason) ? describeAttachFailure({ code: 'blocked', reason }) : null
}

type Failure = { ok: false; code: string; reason?: string; signerName?: string }

/** A refusal because the PDF is signed (and the user has not confirmed writing into it yet). */
const isSignedRefusal = (result: Failure) => result.code === 'blocked' && result.reason === 'signed'

/** The row with the stored box replaced (the history's before / after snapshots). */
function withBox(row: PdfReaderHighlight, box: Box): PdfReaderHighlight {
  return { ...row, rects: row.rects.map((r, i) => (i === 0 ? { ...r, ...box } : r)) }
}

/**
 * Write a move into the PDF; the row as Main stored it, or null (the reason was shown — or, for a signed PDF,
 * `onSigned` asks the user first).
 */
async function writeMove(
  bookId: string,
  row: PdfReaderHighlight,
  box: Box,
  onSigned: (signerName?: string) => void,
): Promise<{ row: PdfReaderHighlight } | { failed: string | null }> {
  const result = await attachmentsApi.change({ bookId, rowId: row.id, op: 'move', rect: box }).catch(() => null)
  if (!result) {
    toast('The attachment could not be moved. Nothing was changed.')
    return { failed: null }
  }
  if (!result.ok) {
    if (isSignedRefusal(result)) onSigned(result.code === 'blocked' ? result.signerName : undefined)
    else toast(describeAttachFailure(result, 'move') ?? 'The attachment could not be moved. Nothing was changed.')
    return { failed: result.code }
  }
  const saved = result.highlight ? pdfHighlightDtoToReaderHighlight(result.highlight) : null
  return { row: saved ?? withBox(row, box) }
}

/** Refusals no retry can change: the attachment is gone from the PDF, or the step itself is invalid. */
const PERMANENT_FAILURES = new Set(['not_found', 'not_editable', 'invalid_request'])

/** Every history step of row `id` — dropped once the row can no longer be moved (deleted here or elsewhere). */
const stepsOf =
  (id: string) =>
  (action: HighlightAction<PdfReaderHighlight>): boolean =>
    action.kind === 'replace' ? action.before.id === id || action.after.id === id : action.value.id === id

function replaceRow(row: PdfReaderHighlight): void {
  usePdfHighlightsStore.setState((s) => ({ highlights: s.highlights.map((h) => (h.id === row.id ? row : h)) }))
}

export const usePageAttachmentsStore = create<PageAttachmentsState>((set, get) => ({
  bookId: null,
  ...IDLE,

  setBook: (bookId) => {
    if (get().bookId !== bookId) set({ bookId, ...IDLE })
  },

  applySync: (event) => {
    if (!event || event.bookId !== get().bookId) return
    // Only a definite answer changes it: a lasting block disables the tool, a write that went through enables it.
    if (event.writeStatus === 'written') set({ writeBlocked: null })
    else if (event.writeStatus && LASTING_BLOCKS.has(event.writeStatus)) set({ writeBlocked: lastingBlock(event.writeStatus) })
    if (!event.pageAttachments) return
    const foreign = event.pageAttachments
    set((s) => {
      const ids = new Set(foreign.map((a) => a.attachmentId))
      const gone = (id: string | null) => id !== null && !ids.has(id) && !usePdfHighlightsStore.getState().highlights.some((h) => h.id === id)
      return {
        foreign,
        selectedId: gone(s.selectedId) ? null : s.selectedId,
        details: s.details && gone(s.details.id) ? null : s.details,
        menu: s.menu && gone(s.menu.pin.id) ? null : s.menu,
      }
    })
  },

  create: async (bookId, pageIndex, point) => {
    if (get().creating) return
    // Known to be unwritable: say why, never open the picker (Main would refuse before it anyway).
    const blocked = get().writeBlocked
    if (blocked) {
      toast(blocked)
      return
    }
    set({ creating: true })
    try {
      const result = await attachmentsApi.create({ bookId, pageIndex, point }).catch(() => null)
      if (!result) {
        toast('The file could not be attached. Nothing was changed.')
        return
      }
      if (!result.ok) {
        if (result.code === 'blocked') set({ writeBlocked: lastingBlock(result.reason) })
        if (isSignedRefusal(result)) {
          // Asked before the picker opens; confirming repeats the attach (now the picker opens).
          set({ signed: { bookId, signerName: result.code === 'blocked' ? result.signerName : undefined, retry: () => void get().create(bookId, pageIndex, point) } })
          return
        }
        const message = describeAttachFailure(result)
        if (message) toast(message)
        return
      }
      set({ writeBlocked: null })
      const row = pdfHighlightDtoToReaderHighlight(result.highlight)
      // The book may have changed while the picker was open: the row belongs to the other book then.
      if (!row || usePdfHighlightsStore.getState().bookId !== bookId) return
      usePdfHighlightsStore.setState((s) => ({ highlights: [...s.highlights.filter((h) => h.id !== row.id), row] }))
      set({ selectedId: row.id })
      const info = row.attachment
      toast(info ? `Attached ${info.name} (${formatAttachmentSize(info.sizeBytes)}).` : 'File attached.')
    } finally {
      set({ creating: false })
    }
  },

  select: (id) => set({ selectedId: id }),

  showDetails: (pin) => set({ selectedId: pin.id, details: pin, menu: null }),

  closeDetails: () => set({ details: null }),

  openMenu: (pin, x, y) => set({ selectedId: pin.id, menu: { pin, x, y } }),

  closeMenu: () => set({ menu: null }),

  requestOpen: (pin) => {
    const { busy, confirming, blocked } = get()
    if (busy || confirming || blocked) return
    const byName = openBlockedByName(pin)
    if (byName) {
      set({ blocked: { pin, message: byName }, details: null })
      return
    }
    set({ confirming: pin, selectedId: pin.id, details: null })
  },

  cancelOpen: () => set({ confirming: null }),

  confirmOpen: async () => {
    const { busy, confirming, bookId } = get()
    if (busy || !confirming || !bookId) return
    set({ busy: true, confirming: null })
    const result = await attachmentsApi.open({ bookId, attachmentId: attachmentIdOfPin(confirming) }).catch(() => null)
    if (get().bookId !== bookId) return set({ busy: false })
    if (result?.ok) {
      set({ busy: false })
      toast(`Opened “${result.fileName}”.`)
    } else if (result?.errorCode === 'blocked') {
      set({ busy: false, blocked: { pin: confirming, message: result.errorMessage } })
    } else {
      set({ busy: false })
      toast(result ? result.errorMessage : 'The attachment could not be opened.')
    }
  },

  saveAs: async (pin) => {
    const { busy, bookId } = get()
    if (busy || !bookId) return
    set({ busy: true })
    const result = await attachmentsApi.saveAs({ bookId, attachmentId: attachmentIdOfPin(pin) }).catch(() => null)
    if (get().bookId !== bookId) return set({ busy: false })
    if (result?.ok) {
      set({ busy: false, blocked: null, details: null })
      toast(`Saved as “${result.fileName}”.`)
    } else if (result?.errorCode === 'canceled') {
      // The dialog that started it stays: the user can try again or close it.
      set({ busy: false })
    } else {
      set({ busy: false, blocked: null })
      toast(result ? result.errorMessage : 'The attachment could not be saved.')
    }
  },

  dismissBlocked: () => set({ blocked: null }),

  move: async (rowId, box) => {
    const { bookId, changing } = get()
    const before = usePdfHighlightsStore.getState().highlights.find((h) => h.id === rowId && h.styleKind === 'attachment')
    if (!bookId || changing || !before) return
    set({ changing: true, moving: { id: rowId, box } })
    try {
      const written = await writeMove(bookId, before, box, (signerName) =>
        set({ signed: { bookId, signerName, retry: () => void get().move(rowId, box) } }),
      )
      if (!('row' in written) || get().bookId !== bookId) return
      replaceRow(written.row)
      usePdfHighlightsStore.getState().history.push(highlightReplace(before, written.row))
    } finally {
      set({ changing: false, moving: null })
    }
  },

  requestDelete: (pin) => {
    if (!pin.editable || get().changing) return
    set({ deleting: pin, selectedId: pin.id, menu: null, details: null })
  },

  cancelDelete: () => set({ deleting: null }),

  confirmDelete: async () => {
    const pin = get().deleting
    set({ deleting: null })
    if (pin && (await get().remove(pin.id))) toast(`Removed “${pin.name}” from the PDF.`)
  },

  confirmSigned: async () => {
    const pending = get().signed
    set({ signed: null })
    if (!pending || pending.bookId !== get().bookId) return
    const result = await overlayApi.confirmSignedPdfWrite(pending.bookId).catch(() => null)
    if (!result?.ok) {
      toast('Could not write into the signed PDF. Nothing was changed.')
      return
    }
    pending.retry()
  },

  declineSigned: () => {
    if (!get().signed) return
    set({ signed: null })
    toast('The signed PDF was not changed.')
  },

  remove: async (rowId) => {
    const { bookId, changing } = get()
    if (!bookId || changing) return false
    set({ changing: true })
    try {
      const result = await attachmentsApi.change({ bookId, rowId, op: 'delete' }).catch(() => null)
      if (get().bookId !== bookId) return false
      if (!result?.ok) {
        if (result && isSignedRefusal(result)) {
          const name = usePdfHighlightsStore.getState().highlights.find((h) => h.id === rowId)?.attachment?.name
          set({
            signed: {
              bookId,
              signerName: result.code === 'blocked' ? result.signerName : undefined,
              retry: () => void get().remove(rowId).then((ok) => ok && name && toast(`Removed “${name}” from the PDF.`)),
            },
          })
          return false
        }
        toast((result && describeAttachFailure(result, 'delete')) ?? 'The attachment could not be deleted. Nothing was changed.')
        return false
      }
      // Its move steps can never be applied again: dropped, so Undo reaches the steps behind them.
      usePdfHighlightsStore.getState().history.dropWhere(stepsOf(rowId))
      usePdfHighlightsStore.setState((s) => ({
        highlights: s.highlights.filter((h) => h.id !== rowId),
        focusedHighlightId: s.focusedHighlightId === rowId ? null : s.focusedHighlightId,
      }))
      set((s) => ({ selectedId: s.selectedId === rowId ? null : s.selectedId, details: s.details?.id === rowId ? null : s.details }))
      return true
    } finally {
      set({ changing: false })
    }
  },
}))

// Undo / redo of a move = another move in the PDF. A refused step stays where it was in the history — unless it can
// never succeed (the attachment is gone): then all of that attachment's steps are dropped, so Undo is never stuck.
registerAttachmentHistory((target, direction) => {
  const store = usePageAttachmentsStore.getState()
  const history = usePdfHighlightsStore.getState().history
  const keepPosition = () => (direction === 'undo' ? history.redo() : history.undo())
  const box = target.rects[0]
  if (!store.bookId || store.changing || !box) {
    keepPosition()
    return
  }
  const bookId = store.bookId
  const rect = { x: box.x, y: box.y, width: box.width, height: box.height }
  usePageAttachmentsStore.setState({ changing: true, moving: { id: target.id, box: rect } })
  const askSigned = (signerName?: string) =>
    usePageAttachmentsStore.setState({
      // Confirming repeats the same history step (the entry was put back where it was).
      signed: { bookId, signerName, retry: () => (direction === 'undo' ? usePdfHighlightsStore.getState().undo() : usePdfHighlightsStore.getState().redo()) },
    })
  void writeMove(bookId, target, rect, askSigned)
    .then((written) => {
      if (usePageAttachmentsStore.getState().bookId !== bookId) return
      if ('row' in written) replaceRow(written.row)
      else if (written.failed && PERMANENT_FAILURES.has(written.failed)) history.dropWhere(stepsOf(target.id))
      else keepPosition()
    })
    .finally(() => usePageAttachmentsStore.setState({ changing: false, moving: null }))
})
