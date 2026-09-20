/**
 * Electron RENDERER — React binding. One SDK instance per window, created at module load; hooks
 * are thin selectors over the SDK's zustand stores via `useSyncExternalStore` (the SDK itself
 * never imports React, so React DOM and React Native hosts bind the same way).
 */
import { useEffect, useSyncExternalStore, type MutableRefObject } from 'react'
import {
  cfiLocation,
  createBookReaderSdk,
  createStoreHook,
  selectBookmarksAt,
  type Location,
  type MarkupAnnotation,
} from '../../../dist/index.mjs'
import { createEpubSurface, type EpubHandleLike } from './epub-surface.js'
import { createIpcStorage, type OverlayBridge } from './ipc-storage.js'

declare global {
  interface Window {
    api: {
      overlay: OverlayBridge
      onRequestFlushSession(handler: () => void | Promise<void>): () => void
    }
  }
}

export const readerSdk = createBookReaderSdk({
  adapters: { storage: createIpcStorage(window.api.overlay) },
  options: { autosaveDelayMs: 800 },
})

// Main asks every window to flush before quitting (T4.2) — hand it the SDK's session flush.
window.api.onRequestFlushSession(async () => {
  await readerSdk.stores.session.getState().flush()
})

export const useAnnotations = createStoreHook(readerSdk.stores.annotations, useSyncExternalStore)
export const useBookmarks = createStoreHook(readerSdk.stores.bookmarks, useSyncExternalStore)
export const useSession = createStoreHook(readerSdk.stores.session, useSyncExternalStore)

/** Mount once in ReaderScreen: opens the book in every store, closes (and flushes) on leave. */
export function useReaderBook(bookId: string | undefined): void {
  useEffect(() => {
    if (!bookId) return
    void readerSdk.openBook(bookId)
    return () => {
      void readerSdk.closeBook()
    }
  }, [bookId])
}

/** Attach epub.js as the render surface while the renderer is mounted. */
export function useEpubSurface<EngineLocation>(
  handleRef: MutableRefObject<EpubHandleLike<EngineLocation> | null>,
  toEngineCfi: (cfi: string) => EngineLocation,
): void {
  useEffect(
    () => readerSdk.attachSurface(createEpubSurface(() => handleRef.current, toEngineCfi)),
    [handleRef, toEngineCfi],
  )
}

/** Toast wiring: every rolled-back optimistic write surfaces once, here. */
export function useSdkErrorToast(showToast: (message: string) => void): void {
  useEffect(
    () => readerSdk.events.on('error', ({ scope, operation }) => showToast(`Could not ${operation} (${scope}).`)),
    [showToast],
  )
}

// ── Example consumers ─────────────────────────────────────────────────────────────────────────

/** Replaces the selection-menu → `createHighlight` path of `highlightsStore.ts`. */
export function markSelection(selection: { cfiRange: string; text: string }, kind: MarkupAnnotation['kind'], spineIndex: number) {
  return readerSdk.stores.annotations.getState().create({
    kind,
    location: cfiLocation(selection.cfiRange),
    chapterIndex: spineIndex,
    selectionText: { highlight: selection.text },
  })
}

export function HighlightsSidebar() {
  const items = useAnnotations((s) => s.items)
  const focusedId = useAnnotations((s) => s.focusedId)
  const canUndo = useAnnotations((s) => s.canUndo)
  const { jumpTo, remove, undo } = readerSdk.stores.annotations.getState()

  return (
    <aside>
      <button disabled={!canUndo} onClick={() => undo()}>
        Undo
      </button>
      <ul>
        {items.map((m) => (
          <li key={m.id} aria-current={m.id === focusedId}>
            <button onClick={() => void jumpTo(m.id)}>
              <span style={{ borderLeft: `4px solid ${m.colorHex}` }}>{m.selectionText?.highlight ?? m.note}</span>
            </button>
            <button onClick={() => void remove(m.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

export function BookmarkRibbon({ current, chapterIndex, label }: { current: Location | null; chapterIndex: number; label: string }) {
  const items = useBookmarks((s) => s.items)
  const isBookmarked = selectBookmarksAt({ items }, current).length > 0

  return (
    <button
      aria-pressed={isBookmarked}
      disabled={!current}
      onClick={() => {
        if (current) void readerSdk.stores.bookmarks.getState().toggleAt({ location: current, chapterIndex, label })
      }}
    >
      {isBookmarked ? '★' : '☆'}
    </button>
  )
}
