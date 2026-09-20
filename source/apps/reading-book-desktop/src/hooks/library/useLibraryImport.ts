import { useCallback, useState } from 'react'
import type {
  ImportClientResult,
  ImportToastVariant,
} from '@reading-book/book-reader-sdk'

type ProgressState = {
  status: string
  filename?: string
} | null

type ToastState = {
  message: string
  variant: ImportToastVariant
} | null

type ConflictState = {
  bookId: string
  message?: string
} | null

export type LibraryImportClient = {
  fromFile: () => Promise<ImportClientResult>
  fromUrl: (url: string) => Promise<ImportClientResult>
}

export type UseLibraryImportOptions = {
  client: LibraryImportClient
  onImported: () => Promise<void>
  onOpenExisting: (bookId: string) => void
}

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
 * Import UX state machine (progress / toast / conflict / URL dialog).
 * Platform injects `client` (Electron IPC / Expo picker+download).
 */
export function useLibraryImport({
  client,
  onImported,
  onOpenExisting,
}: UseLibraryImportOptions) {
  const [toast, setToast] = useState<ToastState>(null)
  const [progress, setProgress] = useState<ProgressState>(null)
  const [urlDialogOpen, setUrlDialogOpen] = useState(false)
  const [conflict, setConflict] = useState<ConflictState>(null)

  const clearToast = useCallback(() => setToast(null), [])

  function showToast(message: string, variant: ImportToastVariant = 'info') {
    setToast({ message, variant })
  }

  async function handleFromDevice() {
    setProgress({ status: 'Importing…' })
    try {
      const result = await client.fromFile()
      if (result.ok && result.bookId) {
        await onImported()
        setToast({
          message: 'Successfully imported to local library',
          variant: 'success',
        })
      } else if (result.errorCode === 'duplicate' && result.bookId) {
        setConflict({
          bookId: result.bookId,
          message: result.errorMessage,
        })
      } else if (result.errorMessage) {
        setToast({ message: result.errorMessage, variant: 'error' })
      }
      // Cancel: no errorCode / errorMessage — silent.
    } catch {
      setToast({ message: 'Could not import file.', variant: 'error' })
    } finally {
      setProgress(null)
    }
  }

  function handleFromUrl() {
    setUrlDialogOpen(true)
  }

  async function handleUrlSubmit(url: string) {
    setUrlDialogOpen(false)
    setProgress({
      status: 'Downloading…',
      filename: filenameFromUrl(url),
    })
    try {
      const result = await client.fromUrl(url)
      if (result.ok && result.bookId) {
        await onImported()
        setToast({
          message: 'Successfully imported to local library',
          variant: 'success',
        })
      } else if (result.errorCode === 'duplicate' && result.bookId) {
        setConflict({
          bookId: result.bookId,
          message: result.errorMessage,
        })
      } else {
        setToast({
          message: result.errorMessage ?? 'Could not download from URL.',
          variant: 'error',
        })
      }
    } catch {
      setToast({ message: 'Could not start URL import.', variant: 'error' })
    } finally {
      setProgress(null)
    }
  }

  function handleConflictDiscard() {
    setConflict(null)
  }

  function handleConflictOpenExisting() {
    const bookId = conflict?.bookId
    setConflict(null)
    if (bookId) onOpenExisting(bookId)
  }

  return {
    toast,
    clearToast,
    showToast,
    progress,
    conflict,
    urlDialogOpen,
    setUrlDialogOpen,
    handleFromDevice,
    handleFromUrl,
    handleUrlSubmit,
    handleConflictDiscard,
    handleConflictOpenExisting,
  }
}
