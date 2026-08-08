import {

  useCallback,

  useEffect,

  useRef,

  useState,

  type MutableRefObject,

} from 'react'

import type {

  EpubPagePreview,

  EpubRendererApi,

} from '../../../../reader/renderers/epub'

import {

  htmlToPreviewDataUrl,

  PREVIEW_THUMB_MAX_HEIGHT,

  PREVIEW_THUMB_MAX_WIDTH,

  wrapSpinePreviewHtml,

} from '../../../../reader/renderers/epub/capture-page-preview'

import { FAKE_CHAPTERS } from '../demo/fakeReaderContent'

import {

  getPagePreviewFromCache,

  hydratePagePreviewsFromCache,

  setPagePreviewCache,

} from './pagePreviewCache'



export type PagePreviewEntry = EpubPagePreview

export type PreviewRequestPriority = 'high' | 'normal'



type UsePagePreviewStoreOptions = {

  enabled: boolean

  bookId: string | undefined

  pageCurrent: number

  pageTotal: number

  isEpubSurface: boolean

  epubApiRef: MutableRefObject<EpubRendererApi | null>

}



const MAX_CONCURRENT = 4



type QueueItem = {

  page: number

  priority: number

}



function runWhenIdle(task: () => void): () => void {

  const w = window as Window & {

    requestIdleCallback?: (

      cb: IdleRequestCallback,

      opts?: IdleRequestOptions,

    ) => number

    cancelIdleCallback?: (id: number) => void

  }

  if (typeof w.requestIdleCallback === 'function') {

    const id = w.requestIdleCallback(() => task(), { timeout: 800 })

    return () => w.cancelIdleCallback?.(id)

  }

  const id = globalThis.setTimeout(task, 48)

  return () => globalThis.clearTimeout(id)

}



function escapeHtml(value: string): string {

  return value

    .replace(/&/g, '&amp;')

    .replace(/</g, '&lt;')

    .replace(/>/g, '&gt;')

    .replace(/"/g, '&quot;')

}



async function fakeChapterPreview(page: number): Promise<PagePreviewEntry | null> {

  const chapter = FAKE_CHAPTERS[page - 1]

  if (!chapter) return null

  const paragraphs = chapter.paragraphs

    .slice(0, 6)

    .map((p) => `<p>${escapeHtml(p)}</p>`)

    .join('')

  const html = wrapSpinePreviewHtml(

    `<h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(chapter.title)}</h1>${paragraphs}`,

  )

  const src = await htmlToPreviewDataUrl(

    html,

    PREVIEW_THUMB_MAX_WIDTH,

    PREVIEW_THUMB_MAX_HEIGHT,

  )

  return src ? { kind: 'image', src } : null

}



function priorityValue(priority: PreviewRequestPriority): number {

  return priority === 'high' ? 0 : 1

}



/**

 * Lazy JPEG page-preview cache for Page Layout thumbnails.

 * - Session cache keyed by bookId + page

 * - Priority queue (viewport first, then nearest to current page)

 * - Bounded concurrency for rasterization

 */

export function usePagePreviewStore({

  enabled,

  bookId,

  pageCurrent,

  pageTotal,

  isEpubSurface,

  epubApiRef,

}: UsePagePreviewStoreOptions) {

  const [previews, setPreviews] = useState<Map<number, PagePreviewEntry>>(

    () => new Map(),

  )

  const previewsRef = useRef(previews)

  previewsRef.current = previews



  const pageCurrentRef = useRef(pageCurrent)

  pageCurrentRef.current = pageCurrent



  const inflightRef = useRef(new Set<number>())

  const queueRef = useRef<QueueItem[]>([])

  const activeCountRef = useRef(0)

  const generationRef = useRef(0)

  const bookIdRef = useRef(bookId)

  bookIdRef.current = bookId



  const sortQueue = useCallback(() => {

    const focus = pageCurrentRef.current

    queueRef.current.sort((a, b) => {

      if (a.priority !== b.priority) return a.priority - b.priority

      return Math.abs(a.page - focus) - Math.abs(b.page - focus)

    })

  }, [])



  // Reset queue when the book changes; hydrate JPEG cache for the new book.

  useEffect(() => {

    generationRef.current += 1

    inflightRef.current.clear()

    queueRef.current = []

    activeCountRef.current = 0

    setPreviews(hydratePagePreviewsFromCache(bookId, pageTotal))

  }, [bookId, pageTotal])



  const putPreview = useCallback((page: number, entry: PagePreviewEntry) => {

    setPagePreviewCache(bookIdRef.current, page, entry.src)

    setPreviews((prev) => {

      const existing = prev.get(page)

      if (existing?.src === entry.src) return prev

      const next = new Map(prev)

      next.set(page, entry)

      return next

    })

  }, [])



  const pumpQueue = useCallback(() => {

    const generation = generationRef.current

    sortQueue()



    while (

      activeCountRef.current < MAX_CONCURRENT &&

      queueRef.current.length > 0

    ) {

      const item = queueRef.current.shift()

      if (item == null) break

      const { page } = item



      if (

        previewsRef.current.has(page) ||

        getPagePreviewFromCache(bookIdRef.current, page)

      ) {

        const cached = getPagePreviewFromCache(bookIdRef.current, page)

        if (cached && !previewsRef.current.has(page)) {

          putPreview(page, { kind: 'image', src: cached })

        }

        inflightRef.current.delete(page)

        continue

      }



      activeCountRef.current += 1

      void (async () => {

        try {

          let entry: PagePreviewEntry | null = null

          if (isEpubSurface) {

            entry = (await epubApiRef.current?.getPagePreview(page)) ?? null

          } else {

            entry = await fakeChapterPreview(page)

          }

          if (generation !== generationRef.current) return

          if (entry) putPreview(page, entry)

        } finally {

          if (generation === generationRef.current) {

            activeCountRef.current = Math.max(0, activeCountRef.current - 1)

            inflightRef.current.delete(page)

            pumpQueue()

          }

        }

      })()

    }

  }, [epubApiRef, isEpubSurface, putPreview, sortQueue])



  const requestPreview = useCallback(

    (page: number, priority: PreviewRequestPriority = 'normal') => {

      if (!enabled) return

      if (!Number.isFinite(page) || page < 1 || page > pageTotal) return



      const cached = getPagePreviewFromCache(bookIdRef.current, page)

      if (cached) {

        if (!previewsRef.current.has(page)) {

          putPreview(page, { kind: 'image', src: cached })

        }

        return

      }

      if (previewsRef.current.has(page)) return



      const nextPriority = priorityValue(priority)

      const existing = queueRef.current.find((item) => item.page === page)

      if (existing) {

        existing.priority = Math.min(existing.priority, nextPriority)

        sortQueue()

        pumpQueue()

        return

      }

      if (inflightRef.current.has(page)) return



      inflightRef.current.add(page)

      queueRef.current.push({ page, priority: nextPriority })

      pumpQueue()

    },

    [enabled, pageTotal, pumpQueue, putPreview, sortQueue],

  )



  // Keep a high-fidelity snapshot of the page the reader is on.

  useEffect(() => {

    if (!enabled || !isEpubSurface) return

    if (pageCurrent < 1) return

    const generation = generationRef.current

    return runWhenIdle(() => {

      if (generation !== generationRef.current) return

      void (async () => {

        const snap = await epubApiRef.current?.captureVisiblePreview(

          PREVIEW_THUMB_MAX_WIDTH,

          PREVIEW_THUMB_MAX_HEIGHT,

        )

        if (!snap || generation !== generationRef.current) return

        putPreview(pageCurrent, { kind: 'image', src: snap })

      })()

    })

  }, [enabled, epubApiRef, isEpubSurface, pageCurrent, putPreview])



  return {

    previews,

    requestPreview,

  }

}


