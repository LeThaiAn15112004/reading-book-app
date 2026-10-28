import { useHighlightsStore } from './highlights/highlightsStore'
import { useMdHighlightsStore } from './mdHighlights/mdHighlightsStore'
import { usePdfHighlightsStore } from './pdfHighlights/pdfHighlightsStore'
import { useTxtDocumentStore } from './txtDocument/txtDocumentStore'
import type { AnnotationReloader } from './annotationTransferStore'

/**
 * How the Reader reloads the annotations of its open book after a committed import (specs/006-annotation-import-export).
 * Each format reloads through its own store. TXT first waits for / flushes its save loop, so an unsaved edit is written
 * rather than lost; if that save fails nothing is reloaded and the caller tells the user the annotations will show after
 * the book is reopened.
 */
export function createAnnotationReloader(bookId: string, format: string | null | undefined): AnnotationReloader {
  return async () => {
    switch (format) {
      case 'epub':
        await useHighlightsStore.getState().loadHighlights()
        return true
      case 'pdf':
        await usePdfHighlightsStore.getState().loadHighlights()
        return true
      case 'md':
        await useMdHighlightsStore.getState().loadHighlights()
        return true
      case 'txt': {
        const saved = await useTxtDocumentStore.getState().flush()
        if (!saved) return false
        await useTxtDocumentStore.getState().load(bookId)
        return true
      }
      default:
        return true
    }
  }
}
