import ePubImport, { type Book, type Rendition } from 'epubjs'
import {
  READER_THEME_COLORS,
  type ReaderTheme,
} from '@reading-book/shared/models'

/** Vite/CJS interop: default may be the ePub fn or a module namespace. */
const ePub =
  typeof ePubImport === 'function'
    ? ePubImport
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ePubImport as any).default

export type EpubPageLayout = 'single' | 'dual'
export type EpubPageMode = 'scroll' | 'paginated'

/** Coarse location for footer scrub (not persisted — G4 owns CFI). */
export type EpubNavState = {
  spineIndex: number
  spineLength: number
  /** 1-based spine page for UI (“3 / 42”). */
  pageCurrent: number
  pageTotal: number
  href: string
  label: string
  /** 0..1 from spine index (length 1 → 0). */
  progress: number
}

export interface EpubjsHandle {
  book: Book
  rendition: Rendition
  destroy: () => void
  next: () => Promise<void>
  prev: () => Promise<void>
  nextPage: () => Promise<void>
  prevPage: () => Promise<void>
  nextSection: () => Promise<void>
  prevSection: () => Promise<void>
  goToSpineIndex: (index: number) => Promise<void>
  getSpineLength: () => number
  getNavState: () => EpubNavState
  setTheme: (theme: ReaderTheme) => void
  setLayout: (layout: EpubPageLayout) => void
  /** Reflow text size (EPUB zoom) — px base; epubjs applies as %. */
  setFontSize: (px: number) => void
  resize: () => void
}

/** Default Aa panel size — zoom % is relative to this. */
export const EPUB_BASE_FONT_PX = 18

function spineLengthOf(book: Book): number {
  const spine = book.spine as { length?: number }
  return typeof spine.length === 'number' ? spine.length : 0
}

function basenameLabel(href: string): string {
  const raw = href.split('/').pop() ?? href
  const noQuery = raw.split('?')[0] ?? raw
  const noHash = noQuery.split('#')[0] ?? noQuery
  const stem = noHash.replace(/\.(x?html?|xml)$/i, '')
  try {
    return decodeURIComponent(stem)
  } catch {
    return stem
  }
}

export function buildEpubNavState(
  book: Book,
  spineIndex: number,
): EpubNavState {
  const spineLength = spineLengthOf(book)
  const pageTotal = Math.max(spineLength, 1)
  const clamped =
    spineLength <= 0
      ? 0
      : Math.min(Math.max(spineIndex, 0), spineLength - 1)
  const pageCurrent = spineLength <= 0 ? 0 : clamped + 1
  const section = book.spine.get(clamped)
  const href = section?.href ?? ''
  const base = href ? basenameLabel(href) : ''
  const label = base || 'Page'
  const progress =
    spineLength <= 1 ? 0 : clamped / (spineLength - 1)
  return {
    spineIndex: clamped,
    spineLength,
    pageCurrent,
    pageTotal,
    href,
    label,
    progress,
  }
}

export function applyEpubFontSize(rendition: Rendition, px: number): void {
  const clamped = Math.min(32, Math.max(12, px))
  const pct = Math.round((clamped / EPUB_BASE_FONT_PX) * 100)
  rendition.themes.fontSize(`${pct}%`)
}

export function applyEpubTheme(rendition: Rendition, theme: ReaderTheme): void {
  const { color, background, link, linkVisited, linkHover } =
    READER_THEME_COLORS[theme]
  // !important so author EPUB CSS (often dark link on dark page) cannot hide TOC/links.
  rendition.themes.default({
    body: {
      color,
      background,
    },
    /* Cover / full-bleed images still participate as normal spine pages. */
    img: {
      'max-width': '100% !important',
      'max-height': '100vh !important',
      'object-fit': 'contain',
      'object-position': 'center',
    },
    'svg, image': {
      'max-width': '100%',
      'max-height': '100%',
    },
    a: {
      color: `${link} !important`,
      'text-decoration': 'underline !important',
      'text-underline-offset': '2px',
    },
    'a:link': { color: `${link} !important` },
    'a:visited': { color: `${linkVisited} !important` },
    'a:hover': { color: `${linkHover} !important` },
    'a:focus': { color: `${linkHover} !important` },
  })
}

function abortError(): Error {
  const err = new Error('EPUB open aborted')
  err.name = 'AbortError'
  return err
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

/** Fresh ArrayBuffer copy (IPC / TypedArray safe). */
export function toArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    const copy = new Uint8Array(data.byteLength)
    copy.set(new Uint8Array(data))
    return copy.buffer
  }
  const view = data as ArrayBufferView
  const copy = new Uint8Array(view.byteLength)
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  return copy.buffer
}

function waitForHostSize(
  host: HTMLElement,
  signal?: AbortSignal,
  timeoutMs = 4000,
): Promise<{ width: number; height: number }> {
  const read = () => {
    const r = host.getBoundingClientRect()
    return { width: Math.floor(r.width), height: Math.floor(r.height) }
  }
  const first = read()
  if (first.width > 0 && first.height > 0) return Promise.resolve(first)

  return new Promise((resolve, reject) => {
    const started = Date.now()
    const ro = new ResizeObserver(() => {
      const size = read()
      if (size.width > 0 && size.height > 0) {
        cleanup()
        resolve(size)
      }
    })
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }
    const timer = window.setInterval(() => {
      const size = read()
      if (size.width > 0 && size.height > 0) {
        cleanup()
        resolve(size)
        return
      }
      if (Date.now() - started > timeoutMs) {
        cleanup()
        resolve({ width: Math.max(size.width, 320), height: Math.max(size.height, 480) })
      }
    }, 50)
    const cleanup = () => {
      ro.disconnect()
      window.clearInterval(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    ro.observe(host)
  })
}

function flowForMode(pageMode: EpubPageMode, layout: EpubPageLayout): string {
  // Dual spread requires paginated columns.
  if (layout === 'dual') return 'paginated'
  return pageMode === 'scroll' ? 'scrolled-doc' : 'paginated'
}

function spreadForLayout(layout: EpubPageLayout): 'always' | 'none' {
  return layout === 'dual' ? 'always' : 'none'
}

export type OpenEpubjsOptions = {
  theme?: ReaderTheme
  signal?: AbortSignal
  /** 1 page vs 2-page spread (center gutter drawn in React). */
  layout?: EpubPageLayout
  pageMode?: EpubPageMode
  /** Initial reflow size in px (default 18). */
  fontSize?: number
}

/**
 * Open an EPUB from ArrayBuffer into `host`.
 * Spine order is preserved — cover (or any first item) is a normal page.
 */
export async function openEpubjs(
  buffer: ArrayBuffer | ArrayBufferView,
  host: HTMLElement,
  themeOrOptions: ReaderTheme | OpenEpubjsOptions = 'night',
): Promise<EpubjsHandle> {
  const options: OpenEpubjsOptions =
    typeof themeOrOptions === 'string'
      ? { theme: themeOrOptions }
      : themeOrOptions
  const theme = options.theme ?? 'night'
  const signal = options.signal
  let layout: EpubPageLayout = options.layout ?? 'single'
  const pageMode: EpubPageMode = options.pageMode ?? 'paginated'
  const initialFontSize = options.fontSize ?? EPUB_BASE_FONT_PX

  if (typeof ePub !== 'function') {
    throw new Error('epubjs failed to load (default export is not a function)')
  }

  throwIfAborted(signal)

  const bytes = toArrayBuffer(buffer)
  if (bytes.byteLength < 22) {
    throw new Error('EPUB payload is empty or truncated')
  }

  const openToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  host.dataset.epubOpen = openToken

  const book = ePub(bytes, { openAs: 'binary' }) as Book
  let rendition: Rendition | null = null
  let settled = false

  const destroyBook = () => {
    try {
      book.destroy()
    } catch {
      /* ignore */
    }
    if (host.dataset.epubOpen === openToken) {
      host.replaceChildren()
      delete host.dataset.epubOpen
    }
  }

  const onAbort = () => {
    if (!settled) destroyBook()
  }
  signal?.addEventListener('abort', onAbort)

  try {
    await book.ready
    throwIfAborted(signal)

    const size = await waitForHostSize(host, signal)
    throwIfAborted(signal)

    if (host.dataset.epubOpen !== openToken) {
      throw abortError()
    }
    host.replaceChildren()
    rendition = book.renderTo(host, {
      width: size.width,
      height: size.height,
      flow: flowForMode(pageMode, layout),
      spread: spreadForLayout(layout),
      // Show every spine item in order (cover included when publishers put it in spine).
      allowScriptedContent: false,
    })
    // Start at first spine item — cover or chapter, whatever the book defines.
    await rendition.display()
    throwIfAborted(signal)
    applyEpubTheme(rendition, theme)
    applyEpubFontSize(rendition, initialFontSize)
  } catch (err) {
    destroyBook()
    throw err
  } finally {
    settled = true
    signal?.removeEventListener('abort', onAbort)
  }

  const activeRendition = rendition
  if (!activeRendition) {
    destroyBook()
    throw new Error('EPUB rendition failed to start')
  }

  const resizeToHost = () => {
    const r = host.getBoundingClientRect()
    const w = Math.floor(r.width)
    const h = Math.floor(r.height)
    if (w > 0 && h > 0) {
      activeRendition.resize(w, h)
    }
  }

  const getSpineLength = () => spineLengthOf(book)

  const currentSpineIndex = (): number => {
    const start = activeRendition.location?.start
    if (start && typeof start.index === 'number') return start.index
    return 0
  }

  const goToSpineIndex = async (index: number) => {
    const n = getSpineLength()
    if (n <= 0) return
    const clamped = Math.min(Math.max(Math.round(index), 0), n - 1)
    await activeRendition.display(clamped)
  }

  const nextPage = async () => {
    await activeRendition.next()
  }
  const prevPage = async () => {
    await activeRendition.prev()
  }

  return {
    book,
    rendition: activeRendition,
    destroy: () => {
      destroyBook()
    },
    next: nextPage,
    prev: prevPage,
    nextPage,
    prevPage,
    nextSection: async () => {
      await goToSpineIndex(currentSpineIndex() + 1)
    },
    prevSection: async () => {
      await goToSpineIndex(currentSpineIndex() - 1)
    },
    goToSpineIndex,
    getSpineLength,
    getNavState: () => buildEpubNavState(book, currentSpineIndex()),
    setTheme: (next) => {
      applyEpubTheme(activeRendition, next)
    },
    setLayout: (next) => {
      layout = next
      activeRendition.spread(spreadForLayout(next))
      resizeToHost()
    },
    setFontSize: (px) => {
      applyEpubFontSize(activeRendition, px)
      resizeToHost()
    },
    resize: resizeToHost,
  }
}
