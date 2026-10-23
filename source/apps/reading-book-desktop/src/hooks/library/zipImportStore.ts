import { create } from 'zustand'
import {
  canConfirmSelection,
  deselectAllTracks,
  initialSelection,
  selectAllTracks,
  setCover,
  toggleTrack,
  type ZipImportPreview,
  type ZipImportSelection,
} from '@reading-book/book-reader-sdk'
import { zipImportApi } from '../../bridge'
import { useLibraryImportStore } from './libraryImportStore.js'

/** Codes after which choosing the same file again cannot help; the user picks another one. */
export type ZipImportPhase = 'closed' | 'inspecting' | 'preview' | 'confirming' | 'error'

export type ZipImportError = { code: string; message: string }

type ZipImportState = {
  phase: ZipImportPhase
  /** Name of the ZIP being inspected (shown before the preview exists). */
  archiveName: string
  preview: ZipImportPreview | null
  selection: ZipImportSelection
  /** Folder paths the user collapsed in the tree. */
  collapsed: ReadonlySet<string>
  /** Failure shown in the error panel (`phase: 'error'`) or inline above the footer (`phase: 'preview'`). */
  error: ZipImportError | null
  /** Cover entry id → data URL (null = no preview available). */
  coverUrls: Readonly<Record<string, string | null>>
  start: () => Promise<void>
  cancel: () => Promise<void>
  toggleTrack: (id: string) => void
  selectAll: () => void
  deselectAll: () => void
  chooseCover: (id: string | null) => void
  toggleFolder: (path: string) => void
  loadCover: (id: string) => Promise<void>
  confirm: () => Promise<void>
}

const EMPTY_SELECTION: ZipImportSelection = { trackIds: [], coverId: null }

/**
 * Audiobook ZIP import preview. The picker and all archive work happen in Main; this store holds only the
 * preview model and the user's selection, and sends back ids (never paths) on confirm.
 */
export const useZipImportStore = create<ZipImportState>()((set, get) => ({
  phase: 'closed',
  archiveName: '',
  preview: null,
  selection: EMPTY_SELECTION,
  collapsed: new Set(),
  error: null,
  coverUrls: {},

  start: async () => {
    if (get().phase === 'inspecting' || get().phase === 'confirming') return
    // The native picker opens first; Main reports `inspecting` once a file is chosen (cancelled = silent).
    const off = zipImportApi.onInspecting(({ archiveName }) => set({ phase: 'inspecting', archiveName, error: null }))
    try {
      const result = await zipImportApi.pick()
      if (!result.ok) {
        if (result.errorCode === 'cancelled') {
          // Picker dismissed, or inspection cancelled: back to where we were.
          set({ phase: get().preview ? 'preview' : 'closed' })
          return
        }
        set({ phase: 'error', preview: null, error: { code: result.errorCode, message: result.errorMessage } })
        return
      }
      const previous = get().preview
      if (previous) void zipImportApi.discard(previous.sessionId)
      set({
        phase: 'preview',
        preview: result.preview,
        selection: initialSelection(result.preview),
        collapsed: new Set(),
        error: null,
        coverUrls: {},
      })
      if (result.preview.defaultCoverId) void get().loadCover(result.preview.defaultCoverId)
    } catch {
      set({ phase: 'error', preview: null, error: { code: 'unreadable', message: 'Could not open the ZIP file.' } })
    } finally {
      off()
    }
  },

  cancel: async () => {
    const { preview, phase } = get()
    if (phase === 'confirming') return
    if (phase === 'inspecting') await zipImportApi.cancelInspect().catch(() => {})
    set({ phase: 'closed', preview: null, selection: EMPTY_SELECTION, error: null, coverUrls: {} })
    if (preview) await zipImportApi.discard(preview.sessionId).catch(() => {})
  },

  toggleTrack: (id) => {
    const { preview, selection } = get()
    if (preview) set({ selection: toggleTrack(preview, selection, id) })
  },
  selectAll: () => {
    const { preview, selection } = get()
    if (preview) set({ selection: selectAllTracks(preview, selection) })
  },
  deselectAll: () => set({ selection: deselectAllTracks(get().selection) }),
  chooseCover: (id) => {
    const { preview, selection } = get()
    if (!preview) return
    set({ selection: setCover(preview, selection, id) })
    if (id) void get().loadCover(id)
  },
  toggleFolder: (path) => {
    const next = new Set(get().collapsed)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    set({ collapsed: next })
  },

  loadCover: async (id) => {
    const { preview, coverUrls } = get()
    if (!preview || id in coverUrls) return
    const sessionId = preview.sessionId
    const result = await zipImportApi.coverPreview({ sessionId, entryId: id }).catch(() => null)
    if (get().preview?.sessionId !== sessionId) return
    set({ coverUrls: { ...get().coverUrls, [id]: result && result.ok ? result.dataUrl : null } })
  },

  confirm: async () => {
    const { preview, selection, phase } = get()
    if (!preview || phase !== 'preview' || !canConfirmSelection(selection)) return
    set({ phase: 'confirming', error: null })
    try {
      const result = await zipImportApi.confirm({ sessionId: preview.sessionId, selection })
      if (result.ok) {
        set({ phase: 'closed', preview: null, selection: EMPTY_SELECTION, coverUrls: {} })
        useLibraryImportStore.getState().showToast('Audiobook added to your library.', 'success')
        return
      }
      if (result.errorCode === 'session_expired' || result.errorCode === 'archive_changed') {
        set({ phase: 'error', preview: null, error: { code: result.errorCode, message: result.errorMessage } })
        return
      }
      // Stay on the preview so the user can adjust the selection or try again.
      set({ phase: 'preview', error: { code: result.errorCode, message: result.errorMessage } })
    } catch {
      set({ phase: 'preview', error: { code: 'import_failed', message: 'Could not import the audiobook. Try again.' } })
    }
  },
}))
