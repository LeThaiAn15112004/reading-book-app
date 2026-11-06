import { useEffect } from 'react'
import { translationApi } from '../../../../bridge'
import { useTranslationStore } from '../translation/translationStore'

type UseReaderTranslationOptions = {
  bookId: string | undefined
  setToast: (message: string | null) => void
}

/**
 * React-lifecycle adapter over `useTranslationStore` (all state + logic live there): syncs the
 * screen's context in, owns the IPC progress subscription, and cancels/closes on book change or
 * Reader unmount so no request or speech outlives the screen.
 */
export function useReaderTranslation({ bookId, setToast }: UseReaderTranslationOptions) {
  const mode = useTranslationStore((s) => s.mode)
  const popover = useTranslationStore((s) => s.popover)
  const setContext = useTranslationStore((s) => s.setContext)
  const setMode = useTranslationStore((s) => s.setMode)
  const openForSelection = useTranslationStore((s) => s.openForSelection)
  const close = useTranslationStore((s) => s.close)
  const handleProgress = useTranslationStore((s) => s.handleProgress)
  const resetForNewBook = useTranslationStore((s) => s.resetForNewBook)

  useEffect(() => {
    setContext({ setToast })
  }, [setContext, setToast])

  useEffect(() => translationApi.onProgress(handleProgress), [handleProgress])

  useEffect(() => {
    resetForNewBook()
    return () => {
      resetForNewBook()
      setMode(false)
    }
  }, [bookId, resetForNewBook, setMode])

  return {
    mode,
    popoverOpen: popover !== null,
    setMode,
    openForSelection,
    close,
  }
}
