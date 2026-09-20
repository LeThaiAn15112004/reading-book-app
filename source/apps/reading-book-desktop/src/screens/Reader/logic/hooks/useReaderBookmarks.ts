import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { CfiLocation } from '@reading-book/book-reader-sdk'
import {
  bookmarkDtoToReaderBookmark,
  findReaderBookmarksAtLocation,
  packBookmarkLocator,
  readerBookmarkJumpLocation,
  resolveCurrentBookmarkLocation,
  type ReaderBookmark,
} from '@reading-book/book-reader-sdk'
import { overlayApi } from '../../../../bridge'
import {
  waitForFrames,
  type EpubNavState,
  type EpubRendererApi,
} from '../../../../reader/renderers/epub'

/**
 * Hold the just-jumped bookmark as "here" while epub.js settles: in continuous/scroll mode it
 * keeps readjusting scroll position for a while after `display()` resolves, so the location it
 * reports right after a jump may not match the bookmark's own CFI yet.
 */
const JUST_JUMPED_HERE_MS = 2000

type UseReaderBookmarksOptions = {
  bookId: string | undefined
  isEpubSurface: boolean
  epubApiRef: MutableRefObject<EpubRendererApi | null>
  /** Drives recomputation of the current place — a fresh object on every EPUB nav update. */
  epubNav: EpubNavState | null
  /** Fake-surface chapter index (formats without a real renderer yet). */
  chapterIndex: number
  /** Fallback bookmark name when the EPUB reports no section label. */
  chapterLabel: string
  goChapter: (index: number) => void
  setChromeHidden: (hidden: boolean) => void
  setToast: (message: string | null) => void
}

/**
 * Bookmarks for the open book (T5.5 / FR-11) — load, toggle at the current place, jump, delete.
 *
 * Bookmarks persist as `notes` rows with `note_json.group = 'bookmark'`; this hook only ever
 * sees the flat `BookmarkDto` shape through `overlayApi`.
 */
export function useReaderBookmarks({
  bookId,
  isEpubSurface,
  epubApiRef,
  epubNav,
  chapterIndex,
  chapterLabel,
  goChapter,
  setChromeHidden,
  setToast,
}: UseReaderBookmarksOptions) {
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([])
  const [justJumpedId, setJustJumpedId] = useState<string | null>(null)
  const justJumpedTimerRef = useRef<number | null>(null)
  const bookmarksRef = useRef(bookmarks)
  bookmarksRef.current = bookmarks

  useEffect(() => {
    setBookmarks([])
    setJustJumpedId(null)
    if (justJumpedTimerRef.current != null) {
      window.clearTimeout(justJumpedTimerRef.current)
      justJumpedTimerRef.current = null
    }
    if (!bookId) return

    let cancelled = false
    void overlayApi
      .listBookmarks(bookId)
      .then((rows) => {
        if (cancelled) return
        setBookmarks(
          rows
            .map(bookmarkDtoToReaderBookmark)
            .filter((b): b is ReaderBookmark => b != null),
        )
      })
      .catch(() => {
        if (!cancelled) setToast('Could not load bookmarks.')
      })

    return () => {
      cancelled = true
    }
  }, [bookId, setToast])

  useEffect(() => {
    return () => {
      if (justJumpedTimerRef.current != null) {
        window.clearTimeout(justJumpedTimerRef.current)
      }
    }
  }, [])

  /**
   * Where a new bookmark would be placed, and what existing ones are compared against.
   * Reading `epubNav` here is what makes this follow page turns, not just section changes —
   * the renderer hands back a fresh nav object on every location update.
   */
  const { currentLocation, bookmarkChapterIndex } = useMemo(() => {
    // Chapter fallback stored alongside the exact location — EPUB spine, else fake chapter.
    const index = isEpubSurface ? (epubNav?.spineIndex ?? 0) : chapterIndex
    return {
      bookmarkChapterIndex: index,
      currentLocation: resolveCurrentBookmarkLocation({
        isEpubSurface,
        chapterIndex: index,
        epubLocation: epubApiRef.current?.getCurrentLocation(),
      }),
    }
  }, [isEpubSurface, chapterIndex, epubNav, epubApiRef])

  const bookmarksHere = currentLocation
    ? findReaderBookmarksAtLocation(bookmarks, currentLocation)
    : []
  const isCurrentPlaceBookmarked = bookmarksHere.length > 0
  /** Sidebar "Here" badge — exact match first, then the bookmark just jumped to. */
  const currentBookmarkId =
    bookmarksHere[0]?.id ??
    (justJumpedId && bookmarks.some((b) => b.id === justJumpedId)
      ? justJumpedId
      : undefined)

  function persistDelete(id: string) {
    if (!bookId) return
    void overlayApi
      .deleteBookmark({ bookId, id })
      .then((result) => {
        if (!result.ok) setToast('Could not delete bookmark.')
      })
      .catch(() => setToast('Could not delete bookmark.'))
  }

  function toggleBookmark() {
    if (!bookId) return
    if (!currentLocation) {
      setToast('Could not bookmark this place yet.')
      return
    }

    if (bookmarksHere.length > 0) {
      const removeIds = new Set(bookmarksHere.map((b) => b.id))
      setBookmarks((list) => list.filter((b) => !removeIds.has(b.id)))
      for (const b of bookmarksHere) persistDelete(b.id)
      setToast('Bookmark removed.')
      return
    }

    // The renderer mints the id so the optimistic row is the final row — a delete that
    // lands before the save resolves still targets the id the store will have written.
    const bookmark: ReaderBookmark = {
      id: crypto.randomUUID(),
      locatorRef: packBookmarkLocator(currentLocation, bookmarkChapterIndex),
      chapterIndex: bookmarkChapterIndex,
      label: epubNav?.label?.trim() || chapterLabel.trim() || 'Bookmark',
      // Only the EPUB surface can read text at the current position today.
      excerpt: isEpubSurface
        ? epubApiRef.current?.getCurrentExcerpt()
        : undefined,
      createdAt: new Date().toISOString(),
    }
    setBookmarks((list) => [...list, bookmark])
    setToast('Bookmark added.')

    void overlayApi
      .saveBookmark({
        bookId,
        id: bookmark.id,
        locatorRef: bookmark.locatorRef,
        label: bookmark.label,
        excerpt: bookmark.excerpt,
        createdAt: bookmark.createdAt,
      })
      .then((saved) => {
        if (saved) return
        // The store rejected it — drop the optimistic row rather than leaving an entry
        // that disappears on the next reopen.
        setBookmarks((list) => list.filter((b) => b.id !== bookmark.id))
        setToast('Could not save bookmark.')
      })
      .catch(() => {
        setBookmarks((list) => list.filter((b) => b.id !== bookmark.id))
        setToast('Could not save bookmark.')
      })
  }

  function deleteBookmarkById(id: string) {
    if (!bookmarksRef.current.some((b) => b.id === id)) return
    setBookmarks((list) => list.filter((b) => b.id !== id))
    setJustJumpedId((current) => (current === id ? null : current))
    persistDelete(id)
  }

  async function jumpToBookmark(bookmark: ReaderBookmark) {
    if (justJumpedTimerRef.current != null) {
      window.clearTimeout(justJumpedTimerRef.current)
      justJumpedTimerRef.current = null
    }

    try {
      const location = readerBookmarkJumpLocation(bookmark)
      if (location instanceof CfiLocation && isEpubSurface) {
        setJustJumpedId(bookmark.id)
        await epubApiRef.current?.goToLocation(location)
        // Hide chrome only after the jump settles — doing it first races the rendition
        // resize it triggers against epub.js's own scroll-to-CFI work.
        setChromeHidden(true)
        // display() can resolve a frame or two before pagination/reflow finishes.
        await waitForFrames(2)
        justJumpedTimerRef.current = window.setTimeout(() => {
          justJumpedTimerRef.current = null
          setJustJumpedId((current) => (current === bookmark.id ? null : current))
        }, JUST_JUMPED_HERE_MS)
        return
      }
      setChromeHidden(true)
      goChapter(bookmark.chapterIndex)
    } catch {
      setToast("Could not find this bookmark's location in the book.")
    }
  }

  return {
    bookmarks,
    isCurrentPlaceBookmarked,
    currentBookmarkId,
    toggleBookmark,
    jumpToBookmark,
    deleteBookmarkById,
  }
}
