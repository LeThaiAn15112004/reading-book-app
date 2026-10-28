import { create } from 'zustand'
import {
  annotationTransferApi,
  type AnnotationImportPreviewDto,
  type AnnotationImportPreviewResult,
  type AnnotationTransferProgressDto,
} from '../../../bridge'
import { annotationExportMessage } from '../../../utils/annotationTransferMessages'

/** Formats whose books carry annotations that can be exported / imported (audiobooks and the rest never do). */
export const ANNOTATION_TRANSFER_FORMATS: readonly string[] = ['epub', 'pdf', 'txt', 'md']

export function supportsAnnotationTransfer(format: string | null | undefined): boolean {
  return !!format && ANNOTATION_TRANSFER_FORMATS.includes(format)
}

/**
 * Reloads the annotations of the Reader's open book after an import. Resolves false when the reload could not be done
 * safely (TXT with an unsaved edit that failed to save), true otherwise.
 */
export type AnnotationReloader = () => Promise<boolean>

const reloaders = new Map<string, AnnotationReloader>()

/** The Reader registers how to reload its open book; returns the unregister function. */
export function registerAnnotationReloader(bookId: string, reload: AnnotationReloader): () => void {
  reloaders.set(bookId, reload)
  return () => {
    if (reloaders.get(bookId) === reload) reloaders.delete(bookId)
  }
}

export type ImportFailure = { errorCode: string; message: string }

type AnnotationTransferState = {
  /** Annotation count of `countBookId` (what Export would write); 0 until known. */
  count: number
  countBookId: string | null
  exporting: boolean
  /** The import preview being shown (null = no dialog). */
  preview: AnnotationImportPreviewDto | null
  /** The error to show in the import dialog (a file that cannot be imported, a failed confirm). */
  importFailure: ImportFailure | null
  /** Waiting for the open dialog / the plan. */
  picking: boolean
  /** A confirmed import is running. */
  importing: boolean
  progress: AnnotationTransferProgressDto | null
  refreshCount: (bookId: string) => Promise<void>
  exportRestore: (bookId: string, onToast: (message: string | null) => void) => Promise<void>
  /** Save the readable Markdown copy (quotes and comments in reading order; it cannot be imported). */
  exportReadable: (bookId: string, onToast: (message: string | null) => void) => Promise<void>
  /** Open the file dialog and show the preview. `bookId` = the book the import was started from (Reader menu). */
  startImport: (bookId?: string) => Promise<void>
  /** The user's explicit choice of target book. */
  chooseTarget: (bookId: string) => Promise<void>
  /** Write the previewed import; `onToast` receives the result message. */
  confirmImport: (onToast: (message: string | null) => void) => Promise<void>
  /** Close the dialog and drop the session. */
  closeImport: () => void
}

function failureOf(result: { errorCode: string; message?: string }): ImportFailure {
  return { errorCode: result.errorCode, message: result.message || 'The annotations could not be imported.' }
}

let unsubscribeProgress: (() => void) | null = null

/**
 * Annotation import / export state of the open Reader book and of the import dialog
 * (specs/006-annotation-import-export). All file work happens in Main; this only asks Main for the count, starts the
 * export, drives the preview → confirm flow and turns results into toasts.
 */
export const useAnnotationTransferStore = create<AnnotationTransferState>()((set, get) => {
  /** Apply a preview result (pickFile / setTarget). A cancelled file dialog is not an error. */
  function applyPreview(result: AnnotationImportPreviewResult, keepOnFailure: boolean): void {
    if (result.ok) {
      set({ preview: result.preview, importFailure: null })
      return
    }
    if (result.errorCode === 'cancelled') {
      set({ preview: keepOnFailure ? get().preview : null })
      return
    }
    // A file that cannot be imported ends the session in Main; the dialog shows why.
    set({ importFailure: failureOf(result), preview: keepOnFailure ? get().preview : null })
  }

  return {
    count: 0,
    countBookId: null,
    exporting: false,
    preview: null,
    importFailure: null,
    picking: false,
    importing: false,
    progress: null,

    refreshCount: async (bookId) => {
      try {
        const { count } = await annotationTransferApi.count(bookId)
        set({ count, countBookId: bookId })
      } catch {
        set({ count: 0, countBookId: bookId })
      }
    },

    exportRestore: async (bookId, onToast) => {
      if (get().exporting) return
      set({ exporting: true })
      try {
        const shown = annotationExportMessage(await annotationTransferApi.exportRestore(bookId))
        if (shown) onToast(shown.message)
      } catch {
        onToast('Could not export the annotations.')
      } finally {
        set({ exporting: false })
      }
    },

    exportReadable: async (bookId, onToast) => {
      if (get().exporting) return
      set({ exporting: true })
      try {
        const shown = annotationExportMessage(await annotationTransferApi.exportReadable(bookId), 'readable copy')
        if (shown) onToast(shown.message)
      } catch {
        onToast('Could not export the readable copy.')
      } finally {
        set({ exporting: false })
      }
    },

    startImport: async (bookId) => {
      if (get().picking || get().importing) return
      unsubscribeProgress ??= annotationTransferApi.onProgress((progress) => set({ progress }))
      set({ picking: true, importFailure: null, progress: null })
      try {
        applyPreview(await annotationTransferApi.pickFile({ bookId }), false)
      } catch {
        set({ importFailure: { errorCode: 'write_failed', message: 'The file could not be opened.' }, preview: null })
      } finally {
        set({ picking: false })
      }
    },

    chooseTarget: async (bookId) => {
      const current = get().preview
      if (!current || get().picking || get().importing) return
      set({ picking: true, importFailure: null })
      try {
        applyPreview(await annotationTransferApi.setTarget(current.sessionId, bookId), true)
      } catch {
        set({ importFailure: { errorCode: 'write_failed', message: 'The book could not be checked.' } })
      } finally {
        set({ picking: false })
      }
    },

    confirmImport: async (onToast) => {
      const current = get().preview
      if (!current || get().importing || !current.target) return
      const targetId = current.target.bookId
      set({ importing: true, importFailure: null })
      try {
        const result = await annotationTransferApi.confirm(current.sessionId)
        if (!result.ok) {
          if (result.errorCode === 'stale_preview') {
            // The book changed since the preview: show a fresh one for the same book, never write silently.
            applyPreview(await annotationTransferApi.setTarget(current.sessionId, targetId), true)
          }
          set({ importFailure: failureOf(result) })
          return
        }
        // Reload the open book's annotations only after a committed import (never after a rollback).
        let reloaded = true
        const reload = reloaders.get(targetId)
        if (reload) {
          try {
            reloaded = await reload()
          } catch {
            reloaded = false
          }
        }
        set({ preview: null })
        const parts = [`${result.added} added`, `${result.present} already there`, `${result.notPlaced} could not be placed`]
        onToast(`Imported annotations: ${parts.join(', ')}.${reloaded ? '' : ' They will show after you reopen the book.'}`)
      } catch {
        set({ importFailure: { errorCode: 'write_failed', message: 'The annotations could not be imported. Nothing was changed.' } })
      } finally {
        set({ importing: false })
      }
    },

    closeImport: () => {
      const current = get().preview
      if (current) void annotationTransferApi.discard(current.sessionId).catch(() => {})
      set({ preview: null, importFailure: null, picking: false })
    },
  }
})
