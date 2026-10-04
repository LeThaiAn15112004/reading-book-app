import { useCallback, useEffect } from 'react'
import type {
  ImportClientResult,
  ImportErrorCode,
} from '@reading-book/book-reader-sdk'
import {
  useLibraryImportStore,
  type ImportToastAction,
} from './libraryImportStore.js'

/** Step / byte progress pushed by the platform while an import runs. */
export type LibraryImportProgress = {
  stage: 'downloading' | 'importing'
  filename?: string
  receivedBytes?: number
  totalBytes?: number | null
}

export type LibraryImportClient = {
  fromFile: () => Promise<ImportClientResult>
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
      label: 'Open',
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
        store.showToast('Book added to your library.', 'success', openBookAction(result.bookId))
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

  const handleFromDevice = useCallback(async () => {
    const store = useLibraryImportStore.getState()
    if (store.busy) return
    // No overlay yet: the native picker is open. Main reports `importing` once a file is picked.
    store.setBusy(true)
    try {
      const result = await client.fromFile()
      if (await handleCommonResult(result)) return
      if (result.errorCode === 'cancelled') return // picker dismissed — silent
      if (result.errorMessage) {
        useLibraryImportStore.getState().showToast(result.errorMessage, 'error')
      }
    } catch {
      useLibraryImportStore.getState().showToast('Could not import file.', 'error')
    } finally {
      const after = useLibraryImportStore.getState()
      after.setBusy(false)
      after.setProgress(null)
    }
  }, [client, handleCommonResult])

  const handleFromUrl = useCallback(() => {
    useLibraryImportStore.getState().openUrlDialog()
  }, [])

  const handleUrlSubmit = useCallback(
    async (url: string) => {
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
          const message = result.errorMessage ?? 'Could not download from URL.'
          if (code === 'cancelled') {
            after.showToast('Download cancelled.', 'info')
          } else if (code && URL_RETRYABLE_ERRORS.has(code)) {
            after.openUrlDialog(target, { message, retryable: true })
          } else if (code && URL_INPUT_ERRORS.has(code)) {
            after.openUrlDialog(target, { message, retryable: false })
          } else if (code === 'save_failed') {
            after.showToast(message, 'error', { label: 'Retry', run: () => void run(target) })
          } else {
            after.showToast(message, 'error')
          }
        } catch {
          useLibraryImportStore
            .getState()
            .openUrlDialog(target, { message: 'Could not start URL import.', retryable: true })
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

