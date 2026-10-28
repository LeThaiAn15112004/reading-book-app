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
import { audioApi, zipImportApi } from '../../bridge'
import { useLibraryImportStore } from './libraryImportStore.js'

/** Chapters written so far while an import runs (from Main). */
export type ZipImportProgress = { stage: 'extracting' | 'saving'; done: number; total: number; name?: string }

/** The preview dialog's phases. The import itself is NOT a phase: it runs as a background `job` after the dialog closed. */
export type ZipImportPhase = 'closed' | 'inspecting' | 'preview' | 'error'

export type ZipImportError = { code: string; message: string }

/** One imported audio file, as the result panel lists it. */
export type ZipImportedTrack = { title: string; durationSeconds: number | null }

/**
 * The import that runs after "Import" was pressed. The preview dialog is already closed, so the rest of the app stays
 * usable (other books can be read, the Library browsed) while Main works; this record is what the "Audiobook ZIP" button
 * (spinner + count) and the job / result panel show. It lives in this module-level store, so it survives leaving the Library.
 */
export type ZipImportJob = {
  archiveName: string
  status: 'running' | 'done' | 'failed'
  /** How many tracks were selected. */
  total: number
  progress: ZipImportProgress | null
  /** A stop was requested; Main honours it until its database write. */
  cancelling: boolean
  /** `done`: the new library book and the audio files that were imported into it, in playback order. */
  bookId?: string
  tracks?: ZipImportedTrack[]
  /** `failed` */
  error?: ZipImportError
  /** `failed` with a retryable cause: the preview and selection to go back to ("Review & retry"). */
  retry?: { preview: ZipImportPreview; selection: ZipImportSelection }
}

type ZipImportState = {
  phase: ZipImportPhase
  /** Name of the ZIP being inspected (shown before the preview exists). */
  archiveName: string
  preview: ZipImportPreview | null
  selection: ZipImportSelection
  /** Folder paths the user collapsed in the tree. */
  collapsed: ReadonlySet<string>
  /** Failure shown in the preview dialog's error view (`phase: 'error'`). */
  error: ZipImportError | null
  /** Cover entry id → data URL (null = no preview available). */
  coverUrls: Readonly<Record<string, string | null>>
  /** The background import (running, finished or failed) or `null`. */
  job: ZipImportJob | null
  /** The job / result panel is open. It opens by itself when a job finishes or fails. */
  panelOpen: boolean
  /** Bumped after every successful import so the Library list reloads. */
  importedNonce: number
  start: () => Promise<void>
  /** Open the preview for the ZIP chosen in the ordinary "Add file" dialog (Main holds its path). */
  startFromPicked: () => Promise<void>
  cancel: () => Promise<void>
  toggleTrack: (id: string) => void
  selectAll: () => void
  deselectAll: () => void
  chooseCover: (id: string | null) => void
  toggleFolder: (path: string) => void
  loadCover: (id: string) => Promise<void>
  /** Close the dialog at once and run the import in the background. */
  confirm: () => Promise<void>
  /** Stop the running import (until its database write). */
  cancelJob: () => Promise<void>
  /** Hide a finished / failed job (a failed one also drops the preview session kept in Main). */
  dismissJob: () => void
  /** Show or hide the job panel. */
  setPanelOpen: (open: boolean) => void
  /** After a failure: back to the preview with the same selection. */
  reviewAndRetry: () => void
}

const EMPTY_SELECTION: ZipImportSelection = { trackIds: [], coverId: null }

/** Short progress text for the Audiobook ZIP entry: `12/68`, or `Saving…` once every track is in place. */
export function zipJobShortLabel(job: Pick<ZipImportJob, 'total' | 'progress' | 'cancelling'>): string {
  if (job.cancelling) return 'Cancelling…'
  if (job.progress?.stage === 'saving') return 'Saving…'
  return `${Math.min(job.progress?.done ?? 0, job.total)}/${job.total}`
}

/** Longer progress text for the panel: which track is being worked on. */
export function zipJobDetail(job: Pick<ZipImportJob, 'total' | 'progress' | 'cancelling'>): string {
  if (job.cancelling) return 'Cancelling…'
  const p = job.progress
  if (!p) return 'Starting…'
  if (p.stage === 'saving') return 'Saving to your library…'
  return `Track ${Math.min(p.done + 1, job.total)} of ${job.total}${p.name ? ` — ${p.name}` : ''}`
}

const stem = (name: string): string => name.replace(/\.[^./\\]+$/, '')

/**
 * Run one inspection: `open` is either Main's own ZIP picker or the inspection of the ZIP chosen in "Add file". Main
 * reports `inspecting` once a file is known (a dismissed picker stays silent); the result becomes the preview or an error.
 */
async function inspect(open: () => Promise<Awaited<ReturnType<typeof zipImportApi.pick>>>): Promise<void> {
  const { getState: get, setState: set } = useZipImportStore
  // One ZIP at a time: while an import runs the entry is a spinner, and a second inspection cannot start.
  if (get().job?.status === 'running') {
    // e.g. a ZIP chosen in "Add file" while another import runs: say so and show the running import.
    useLibraryImportStore.getState().showToast('An audiobook import is already running. Wait for it to finish.', 'info')
    set({ panelOpen: true })
    return
  }
  if (get().phase === 'inspecting') return
  // The card behind the entry's spinner starts hidden: only the spinner shows until the user opens it.
  const off = zipImportApi.onInspecting(({ archiveName }) => set({ phase: 'inspecting', archiveName, error: null, panelOpen: false }))
  try {
    const result = await open()
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
}

/** Audio files for the result panel: the real tracks of the new book, else (a one-track import is a plain book) the selected names. */
async function importedTracks(bookId: string, fallbackNames: string[]): Promise<ZipImportedTrack[]> {
  const result = await audioApi.getTracks(bookId).catch(() => null)
  if (result && result.ok && result.tracks.length > 0) {
    return result.tracks.map((t) => ({ title: t.title, durationSeconds: t.durationSeconds }))
  }
  return fallbackNames.map((title) => ({ title, durationSeconds: null }))
}

/**
 * Audiobook ZIP import. The picker and all archive work happen in Main; this store holds the preview model and the
 * user's selection, and sends back ids (never paths) on confirm. Confirming does not keep the dialog open: it closes at
 * once and the import continues as a background `job` (button spinner + panel).
 */
export const useZipImportStore = create<ZipImportState>()((set, get) => ({
  phase: 'closed',
  archiveName: '',
  preview: null,
  selection: EMPTY_SELECTION,
  collapsed: new Set(),
  error: null,
  coverUrls: {},
  job: null,
  panelOpen: false,
  importedNonce: 0,

  // Two ways in: the "Audiobook ZIP" entry (Main opens its own ZIP picker) and the ordinary "Add file" dialog, where the
  // user picked a .zip (Main holds the path and the renderer asks it to inspect that one).
  start: () => inspect(() => zipImportApi.pick()),
  startFromPicked: () => inspect(() => zipImportApi.inspectPicked()),

  cancel: async () => {
    const { preview, phase } = get()
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
    const { preview, selection, phase, job } = get()
    if (!preview || phase !== 'preview' || !canConfirmSelection(selection) || job?.status === 'running') return
    const byId = new Map(preview.entries.map((e) => [e.id, e.name]))
    const selectedNames = selection.trackIds.map((id) => stem(byId.get(id) ?? 'Track'))

    // The dialog goes away NOW; everything below happens in the background while the app stays usable.
    set({
      phase: 'closed',
      preview: null,
      selection: EMPTY_SELECTION,
      coverUrls: {},
      error: null,
      job: { archiveName: preview.archiveName, status: 'running', total: selection.trackIds.length, progress: null, cancelling: false },
      panelOpen: false,
    })
    const off = zipImportApi.onProgress((progress) =>
      set((s) => (s.job?.status === 'running' ? { job: { ...s.job, progress } } : {})),
    )
    const fail = (error: ZipImportError, retryable: boolean) =>
      set((s) => ({
        job: s.job ? { ...s.job, status: 'failed', error, progress: null, cancelling: false, retry: retryable ? { preview, selection } : undefined } : s.job,
        panelOpen: true,
      }))
    try {
      const result = await zipImportApi.confirm({ sessionId: preview.sessionId, selection })
      if (result.ok) {
        const tracks = await importedTracks(result.bookId, selectedNames)
        set((s) => ({
          job: s.job ? { ...s.job, status: 'done', bookId: result.bookId, tracks, progress: null, cancelling: false } : s.job,
          panelOpen: true,
          importedNonce: s.importedNonce + 1,
        }))
        return
      }
      if (result.errorCode === 'cancelled') {
        // The user stopped it: nothing was added. The preview session is still in Main; drop it.
        set({ job: null, panelOpen: false })
        void zipImportApi.discard(preview.sessionId).catch(() => {})
        useLibraryImportStore.getState().showToast('Audiobook import cancelled.', 'info')
        return
      }
      if (result.errorCode === 'duplicate' && result.bookId) {
        // Same tracks, same order: reuse the Library's "already in your library — open it?" dialog.
        set({ job: null, panelOpen: false })
        void zipImportApi.discard(preview.sessionId).catch(() => {})
        useLibraryImportStore.getState().setConflict({ bookId: result.bookId, message: result.errorMessage })
        return
      }
      // A vanished or changed ZIP cannot be retried from the same preview; anything else can (adjust and try again).
      fail(
        { code: result.errorCode, message: result.errorMessage },
        result.errorCode !== 'session_expired' && result.errorCode !== 'archive_changed',
      )
    } catch {
      fail({ code: 'import_failed', message: 'Could not import the audiobook. Nothing was added to your library.' }, true)
    } finally {
      off()
    }
  },

  cancelJob: async () => {
    const { job } = get()
    if (!job || job.status !== 'running' || job.cancelling) return
    set({ job: { ...job, cancelling: true } })
    // Main stops at the next step (or ignores it once the database write began); confirm() then resolves and settles the job.
    await zipImportApi.cancelImport().catch(() => {})
  },

  dismissJob: () => {
    const { job } = get()
    if (!job || job.status === 'running') return
    if (job.retry) void zipImportApi.discard(job.retry.preview.sessionId).catch(() => {})
    set({ job: null, panelOpen: false })
  },

  setPanelOpen: (open) => set({ panelOpen: open }),

  reviewAndRetry: () => {
    const { job, phase } = get()
    if (!job?.retry || job.status !== 'failed' || phase !== 'closed') return
    const { preview, selection } = job.retry
    set({ job: null, panelOpen: false, phase: 'preview', preview, selection, collapsed: new Set(), error: null, coverUrls: {} })
    if (preview.defaultCoverId) void get().loadCover(preview.defaultCoverId)
  },
}))
