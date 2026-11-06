import {
  useReadingSessionAutosave as useSharedReadingSessionAutosave,
  type SessionLatestSnapshot,
  type SessionNavMeta,
  type SessionThemeFields,
  type UseReadingSessionAutosaveOptions,
} from '../../../../hooks/reader/index.js'
import { overlayApi } from '../../../../bridge'
import { registerSessionFlushHandler } from './sessionFlushRegistry'

export type {
  SessionLatestSnapshot,
  SessionNavMeta,
  SessionThemeFields,
}

type DesktopReadingSessionAutosaveOptions = Pick<
  UseReadingSessionAutosaveOptions,
  'bookId' | 'getLatest'
>

function bindDesktopBackgroundFlush(flush: () => Promise<void>): () => void {
  const onBlur = () => {
    void flush()
  }
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      void flush()
    }
  }
  const onPageHide = () => {
    void flush()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', onPageHide)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', onPageHide)
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }
}

/**
 * Desktop adapter — wires Electron IPC + window lifecycle into shared autosave hook.
 */
export function useReadingSessionAutosave({
  bookId,
  getLatest,
}: DesktopReadingSessionAutosaveOptions) {
  return useSharedReadingSessionAutosave({
    bookId,
    getLatest,
    client: overlayApi,
    registerExternalFlush: registerSessionFlushHandler,
    bindBackgroundFlush: bindDesktopBackgroundFlush,
  })
}
