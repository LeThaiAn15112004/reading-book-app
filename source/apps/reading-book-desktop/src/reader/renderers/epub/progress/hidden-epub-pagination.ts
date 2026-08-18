/**
 * Full-spine page measurement using a separate, off-screen epub.js rendition.
 *
 * The visible reader stays interactive; this pipeline walks every spine item
 * in a hidden host sized to the reader's viewport and returns exact CSS page
 * counts (`displayed.total`) for the current layout/style.
 */

import ePubImport, { type Book, type Rendition } from 'epubjs'
import type { ReaderTheme } from '@reading-book/shared/models'
import {
  applyDualSpreadHost,
  applyEpubFontSize,
  applyEpubReadingStyle,
  applyEpubThemeVars,
  flowForMode,
  injectEpubThemeStyles,
  linkSpineSections,
  managerForMode,
  spineLengthOf,
  spreadForLayout,
  toArrayBuffer,
  waitForFrames,
  waitForSectionResources,
  type EpubPageLayout,
  type EpubPageMode,
  type EpubReadingStyle,
} from '../openEpubjs'
import { displayedPagesFromLocation } from './reader-position'

/** Vite/CJS interop: default may be the ePub fn or a module namespace. */
const ePub =
  typeof ePubImport === 'function'
    ? ePubImport
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ePubImport as any).default

export type HiddenPaginationMeasureInput = {
  buffer: ArrayBuffer | ArrayBufferView
  width: number
  height: number
  theme: ReaderTheme
  layout: EpubPageLayout
  pageMode: EpubPageMode
  fontSize: number
  readingStyle: EpubReadingStyle
  signal?: AbortSignal
}

export type HiddenPaginationMeasureResult = {
  sectionPages: number[]
  spineLength: number
}

function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function createOffscreenHost(width: number, height: number): HTMLElement {
  const host = document.createElement('div')
  host.setAttribute('data-epub-pagination-probe', '1')
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${Math.max(1, Math.floor(width))}px`,
    height: `${Math.max(1, Math.floor(height))}px`,
    opacity: '0',
    pointerEvents: 'none',
    overflow: 'hidden',
    zIndex: '-1',
  })
  document.body.appendChild(host)
  return host
}

function stopRenditionQueue(rendition: Rendition | null | undefined): void {
  if (!rendition) return
  const q = (
    rendition as unknown as {
      q?: { stop?: () => void; clear?: () => void; pause?: () => void }
    }
  ).q
  try {
    q?.stop?.()
  } catch {
    try {
      q?.clear?.()
      q?.pause?.()
    } catch {
      /* ignore */
    }
  }
}

function readRenditionLocation(rendition: Rendition): unknown {
  const prop = rendition.location
  if (prop?.start) return prop
  const method = (
    rendition as unknown as {
      currentLocation?: () => unknown
    }
  ).currentLocation
  if (typeof method === 'function') {
    try {
      return method.call(rendition)
    } catch {
      return undefined
    }
  }
  return prop
}

function currentSectionDocument(rendition: Rendition): Document | null {
  const manager = (
    rendition as unknown as {
      manager?: {
        views?: {
          displayed?: () => Array<{ contents?: { document?: Document } }>
          current?: () => { contents?: { document?: Document } } | undefined
        }
      }
    }
  ).manager
  if (!manager) return null
  const current = manager.views?.current?.()
  if (current?.contents?.document) return current.contents.document
  const displayed = manager.views?.displayed?.()
  if (Array.isArray(displayed) && displayed[0]?.contents?.document) {
    return displayed[0].contents.document
  }
  return null
}

/**
 * Measure CSS page totals for every spine section without touching the
 * visible reader. Safe to abort mid-flight.
 */
export async function measureHiddenEpubPagination(
  input: HiddenPaginationMeasureInput,
): Promise<HiddenPaginationMeasureResult> {
  if (input.pageMode !== 'paginated') {
    return { sectionPages: [], spineLength: 0 }
  }
  if (typeof ePub !== 'function') {
    throw new Error('epubjs failed to load for hidden pagination')
  }

  throwIfAborted(input.signal)

  const bytes = toArrayBuffer(input.buffer)
  const width = Math.max(1, Math.floor(input.width))
  const height = Math.max(1, Math.floor(input.height))
  const host = createOffscreenHost(width, height)

  let book: Book | null = null
  let rendition: Rendition | null = null
  let destroyed = false

  const destroy = () => {
    if (destroyed) return
    destroyed = true
    stopRenditionQueue(rendition)
    try {
      rendition?.destroy()
    } catch {
      /* ignore */
    }
    rendition = null
    try {
      if (book) {
        const bookWithRendition = book as unknown as {
          rendition?: Rendition | null
        }
        bookWithRendition.rendition = null
        book.destroy()
      }
    } catch {
      /* ignore */
    }
    book = null
    host.replaceChildren()
    host.remove()
  }

  const onAbort = () => destroy()
  input.signal?.addEventListener('abort', onAbort)

  try {
    book = ePub(bytes, { openAs: 'binary' }) as Book
    await book.ready
    throwIfAborted(input.signal)

    const spineLength = spineLengthOf(book)
    const sectionPages = new Array(spineLength).fill(1)
    if (spineLength <= 0) {
      destroy()
      return { sectionPages: [], spineLength: 0 }
    }

    rendition = book.renderTo(host, {
      width,
      height,
      flow: flowForMode(input.pageMode),
      manager: managerForMode(input.pageMode),
      spread: spreadForLayout(input.pageMode, input.layout),
      allowScriptedContent: false,
    })
    linkSpineSections(book)
    injectEpubThemeStyles(rendition, input.pageMode)
    applyEpubThemeVars(rendition, input.theme)
    applyEpubReadingStyle(rendition, input.readingStyle)
    applyEpubFontSize(rendition, input.fontSize)
    applyDualSpreadHost(host, input.layout)

    for (let index = 0; index < spineLength; index += 1) {
      throwIfAborted(input.signal)
      await rendition.display(index)
      await waitForFrames(2)
      await waitForSectionResources(currentSectionDocument(rendition))
      if (width > 0 && height > 0) {
        rendition.resize(width, height)
      }
      await waitForFrames(2)
      rendition.reportLocation()
      await waitForFrames(1)
      const displayed = displayedPagesFromLocation(readRenditionLocation(rendition))
      sectionPages[index] = Math.max(1, displayed.total)
    }

    throwIfAborted(input.signal)
    return { sectionPages, spineLength }
  } finally {
    input.signal?.removeEventListener('abort', onAbort)
    destroy()
  }
}
