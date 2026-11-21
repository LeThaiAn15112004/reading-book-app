import { useCallback, useEffect } from 'react'
import type {
  ImportClientResult,
  ImportErrorCode,
} from '@core'
import {
  useLibraryImportStore,
  type ImportToastAction,
} from './libraryImportStore.js'
import { useZipImportStore } from './zipImportStore.js'
import { registerPickAndQueue, useImportQueueStore } from './importQueueStore.js'
import { getT, type UiText } from '../../i18n'

/** Step / byte progress pushed by the platform while an import runs. */
export type LibraryImportProgress = {
  stage: 'downloading' | 'importing'
  filename?: string
  receivedBytes?: number
  totalBytes?: number | null
}

/** Spec 016: one file of a multi-file pick (pick ids only). */
export type LibraryPickedItem = { pickId: string; name: string; sizeBytes: number; kind: 'book' | 'zip' | 'unsupported' }

export type LibraryImportClient = {
  fromFile: () => Promise<ImportClientResult>
  /** Spec 016: multi-file pick (≤ 50) for the background queue. */
  pickFiles?: () => Promise<
    | { status: 'cancelled' }
    | { status: 'failed'; errorMessage: string }
    | { status: 'picked'; items: LibraryPickedItem[]; notAdded: number }
  >
  fromUrl: (url: string) => Promise<ImportClientResult>
  /** Abort the in-flight URL download, when the platform supports it. */
  cancel?: () => Promise<unknown>
  /** Subscribe to progress; returns unsubscribe. */
  onProgress?: (handler: (progress: LibraryImportProgress) => void) => () => void
}

export type UseLibraryImportOptions = {
  client: LibraryImportClient
  onImported: () => Promise<void>
  /** Open a book in the reader (success "Open" action and duplicate "Open existing"). */
  onOpenBook: (bookId: string) => void
}

/** URL failures the user can fix only by changing the link — shown inline, no Retry. */
const URL_INPUT_ERRORS: ReadonlySet<ImportErrorCode> = new Set([
  'scheme',
  'not_direct_file',
  'too_large',
])

/** Transient URL failures — shown inline with a Retry button. */
const URL_RETRYABLE_ERRORS: ReadonlySet<ImportErrorCode> = new Set([
  'network',
  'timeout',
  'http_status',
])

function filenameFromUrl(url: string): string | undefined {
  try {
    const base = url.split('?')[0]?.split('#')[0] ?? url
    const name = base.split('/').pop()
    return name && name.includes('.') ? decodeURIComponent(name) : undefined
  } catch {
    return undefined
  }
}

/**
 * Library import flow (docs/ui-ux-flows.md §9 — Import state machine):
 * Idle → Picking / UrlInput → Downloading → Importing → Success | Duplicate | Failed.
 * Platform injects `client` (Electron IPC / Expo picker+download); UI state lives in
 * `useLibraryImportStore`.
 */
export function useLibraryImport({
  client,
  onImported,
  onOpenBook,
}: UseLibraryImportOptions) {
  const toast = useLibraryImportStore((s) => s.toast)
  const progress = useLibraryImportStore((s) => s.progress)
  const conflict = useLibraryImportStore((s) => s.conflict)
  const urlDialog = useLibraryImportStore((s) => s.urlDialog)
  const showToast = useLibraryImportStore((s) => s.showToast)
  const clearToast = useLibraryImportStore((s) => s.clearToast)

  // Progress arrives from the platform only after a file is picked / a URL submitted.
  useEffect(() => {
    if (!client.onProgress) return
    return client.onProgress((update) => {
      const store = useLibraryImportStore.getState()
      if (!store.busy) return
      store.setProgress({
        source: store.progress?.source ?? 'file',
        ...store.progress,
        ...update,
      })
    })
  }, [client])

  const openBookAction = useCallback(
    (bookId: string): ImportToastAction => ({
      label: { key: 'library.toast.open' },
      run: () => onOpenBook(bookId),
    }),
    [onOpenBook],
  )

  /** Shared outcome handling for file and URL imports. Returns true when fully handled. */
  const handleCommonResult = useCallback(
    async (result: ImportClientResult): Promise<boolean> => {
      const store = useLibraryImportStore.getState()
      if (result.ok && result.bookId) {
        try {
          await onImported()
        } catch {
          // The book is saved; a failed list refresh must not turn success into an error.
        }
        store.showToast({ key: 'library.toast.bookAdded' }, 'success', openBookAction(result.bookId))
        return true
      }
      if (result.errorCode === 'duplicate' && result.bookId) {
        store.setConflict({ bookId: result.bookId, message: result.errorMessage })
        return true
      }
      return false
    },
    [onImported, openBookAction],
  )

  /**
   * Spec 016 (FR-008 / FR-011a): Add file → the picker (several files, ≤ 50) → jobs queued → the menu is already
   * closed; the app stays usable while the queue runs. A ZIP picked alone keeps its preview (FR-014); a ZIP among
   * several files is left out with a message; an unsupported file is queued as failed and counted in the summary.
   */
  const pickIntoQueue = useCallback(async () => {
    if (!client.pickFiles) return
    const result = await client.pickFiles().catch(() => null)
    const store = useLibraryImportStore.getState()
    if (!result) {
      store.showToast({ key: 'library.toast.importFailed' }, 'error')
      return
    }
    if (result.status === 'cancelled') return
    if (result.status === 'failed') {
      store.showToast(result.errorMessage, 'error')
      return
    }
    const zips = result.items.filter((i) => i.kind === 'zip')
    if (result.items.length === 1 && zips.length === 1) {
      void useZipImportStore.getState().startFromPicked()
      return
    }
    if (zips.length > 0) store.showToast({ key: 'import.queue.zipAlone' }, 'info')
    if (result.notAdded > 0) store.showToast({ key: 'import.queue.tooMany', params: { count: result.notAdded } }, 'info')
    useImportQueueStore.getState().addPicked(result.items, result.notAdded, getT()('import.queue.unsupported'))
  }, [client])

  useEffect(() => {
    registerPickAndQueue(pickIntoQueue)
  }, [pickIntoQueue])

  const handleFromDevice = useCallback(async () => {
    if (client.pickFiles) {
      await pickIntoQueue()
      return
    }
    const store = useLibraryImportStore.getState()
    if (store.busy) return
    // No overlay yet: the native picker is open. Main reports `importing` once a file is picked.
    store.setBusy(true)
    try {
      const result = await client.fromFile()
      if (await handleCommonResult(result)) return
      if (result.errorCode === 'cancelled') return // picker dismissed — silent
      if (result.errorCode === 'audiobook_zip') {
        // An audiobook ZIP was picked in the ordinary dialog: not a failure — open its import preview (Main holds the path).
        void useZipImportStore.getState().startFromPicked()
        return
      }
      if (result.errorMessage) {
        useLibraryImportStore.getState().showToast(result.errorMessage, 'error')
      }
    } catch {
      useLibraryImportStore.getState().showToast({ key: 'library.toast.importFailed' }, 'error')
    } finally {
      const after = useLibraryImportStore.getState()
      after.setBusy(false)
      after.setProgress(null)
    }
  }, [client, handleCommonResult, pickIntoQueue])

  const handleFromUrl = useCallback(() => {
    useLibraryImportStore.getState().openUrlDialog()
  }, [])

  const handleUrlSubmit = useCallback(
    async (url: string) => {
      // Spec 016 (FR-008): the link joins the background queue; the dialog closes at once.
      if (client.pickFiles) {
        useLibraryImportStore.getState().closeUrlDialog()
        useImportQueueStore.getState().addUrl(url, filenameFromUrl(url) ?? url)
        return
      }
      async function run(target: string): Promise<void> {
        const store = useLibraryImportStore.getState()
        if (store.busy) return
        store.closeUrlDialog()
        store.setBusy(true)
        store.setProgress({
          source: 'url',
          stage: 'downloading',
          filename: filenameFromUrl(target),
        })
        try {
          const result = await client.fromUrl(target)
          if (await handleCommonResult(result)) return
          const after = useLibraryImportStore.getState()
          const code = result.errorCode
          const message: UiText = result.errorMessage ?? { key: 'library.toast.downloadFailedUrl' }
          if (code === 'cancelled') {
            after.showToast({ key: 'library.toast.downloadCancelled' }, 'info')
          } else if (code && URL_RETRYABLE_ERRORS.has(code)) {
            after.openUrlDialog(target, { message, retryable: true })
          } else if (code && URL_INPUT_ERRORS.has(code)) {
            after.openUrlDialog(target, { message, retryable: false })
          } else if (code === 'save_failed') {
            after.showToast(message, 'error', { label: { key: 'library.toast.retry' }, run: () => void run(target) })
          } else {
            after.showToast(message, 'error')
          }
        } catch {
          useLibraryImportStore
            .getState()
            .openUrlDialog(target, { message: { key: 'library.toast.urlImportStartFailed' }, retryable: true })
        } finally {
          const after = useLibraryImportStore.getState()
          after.setBusy(false)
          after.setProgress(null)
        }
      }
      await run(url)
    },
    [client, handleCommonResult],
  )

  const handleCancelImport = useCallback(() => {
    if (!client.cancel) return
    client.cancel().catch(() => {
      // Nothing to cancel any more (already finished) — the result handler reports the outcome.
    })
  }, [client])

  const closeUrlDialog = useCallback(() => {
    useLibraryImportStore.getState().closeUrlDialog()
  }, [])

  const handleConflictDiscard = useCallback(() => {
    useLibraryImportStore.getState().setConflict(null)
  }, [])

  const handleConflictOpenExisting = useCallback(() => {
    const store = useLibraryImportStore.getState()
    const bookId = store.conflict?.bookId
    store.setConflict(null)
    if (bookId) onOpenBook(bookId)
  }, [onOpenBook])

  /** Raise the duplicate dialog from another import source (Cloud Sources). */
  const showConflict = useCallback((bookId: string, message?: string) => {
    useLibraryImportStore.getState().setConflict({ bookId, message })
  }, [])

  return {
    toast,
    clearToast,
    showToast,
    progress,
    canCancel: Boolean(client.cancel) && progress?.stage === 'downloading',
    conflict,
    showConflict,
    urlDialog,
    closeUrlDialog,
    handleFromDevice,
    handleFromUrl,
    handleUrlSubmit,
    handleCancelImport,
    handleConflictDiscard,
    handleConflictOpenExisting,
  }
}

