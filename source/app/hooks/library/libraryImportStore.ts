import { create } from 'zustand'
import type { ImportToastVariant } from '@reading-book/book-reader-sdk'

export type ImportSource = 'file' | 'url'

/** Overlay shown while an import runs — only once a file was picked / a URL submitted. */
export type ImportProgressState = {
  source: ImportSource
  stage: 'downloading' | 'importing'
  filename?: string
  receivedBytes?: number
  totalBytes?: number | null
}

/** Optional one-click follow-up on a toast (Open, Retry, Connect…). */
export type ImportToastAction = {
  label: string
  run: () => void
}

export type ImportToastState = {
  message: string
  variant: ImportToastVariant
  action?: ImportToastAction
}

export type ImportConflictState = {
  bookId: string
  message?: string
}

/** Inline error shown inside the URL dialog after a failed download. */
export type ImportUrlError = {
  message: string
  /** Transient failure (network / timeout / HTTP): the submit button becomes "Retry". */
  retryable: boolean
}

export type ImportUrlDialogState = {
  open: boolean
  /** URL to pre-fill (kept after a failed download so the user does not retype it). */
  initialUrl: string
  error: ImportUrlError | null
}

type LibraryImportState = {
  /** An import IPC call is in flight; progress events are ignored otherwise. */
  busy: boolean
  progress: ImportProgressState | null
  toast: ImportToastState | null
  conflict: ImportConflictState | null
  urlDialog: ImportUrlDialogState
  setBusy: (busy: boolean) => void
  setProgress: (progress: ImportProgressState | null) => void
  showToast: (
    message: string,
    variant?: ImportToastVariant,
    action?: ImportToastAction,
  ) => void
  clearToast: () => void
  setConflict: (conflict: ImportConflictState | null) => void
  openUrlDialog: (initialUrl?: string, error?: ImportUrlError | null) => void
  closeUrlDialog: () => void
}

const CLOSED_URL_DIALOG: ImportUrlDialogState = { open: false, initialUrl: '', error: null }

/**
 * UI state of the Library import flow (docs/ui-ux-flows.md — Import state machine).
 * `useLibraryImport` drives it; dialogs/toast read it.
 */
export const useLibraryImportStore = create<LibraryImportState>()((set) => ({
  busy: false,
  progress: null,
  toast: null,
  conflict: null,
  urlDialog: CLOSED_URL_DIALOG,

  setBusy: (busy) => set({ busy }),
  setProgress: (progress) => set({ progress }),
  showToast: (message, variant = 'info', action) =>
    set({ toast: { message, variant, action } }),
  clearToast: () => set({ toast: null }),
  setConflict: (conflict) => set({ conflict }),
  openUrlDialog: (initialUrl = '', error = null) =>
    set({ urlDialog: { open: true, initialUrl, error } }),
  closeUrlDialog: () => set({ urlDialog: CLOSED_URL_DIALOG }),
}))
