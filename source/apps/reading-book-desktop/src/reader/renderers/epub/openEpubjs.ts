import type { Book, Rendition } from 'epubjs'
import {
  CfiLocation,
  type HighlightStyleKind,
  type ReaderTheme,
  type TextMatcher,
} from '@reading-book/book-reader-sdk'
import { cfiCodec, tryEncodeCfi, type EpubCfiDecodeResult } from './cfi/cfi-codec'
import {
  installEpubjsStartContainerLogFilter,
  withEpubjsStartContainerLogMutedAsync,
  resolveCfiRange,
} from './cfi/cfi-dom-range'
import { toEpubjsDisplayCfi } from './cfi/selection-cfi'
import {
  cfiFromLocation,
  displayedPagesFromLocation,
  EpubPaginationTracker,
} from './progress/reader-position'
import {
  buildLayoutFingerprint,
  buildPaginationCacheKey,
  fingerprintEpubBytes,
  readPaginationCache,
  writePaginationCache,
} from './progress/epub-pagination-cache'
import {
  createSpineExcerptCache,
  extractExcerpt,
  EXCERPT_MAX_CHARS,
} from './previews/spineExcerptCache'
import {
  clearSearchHighlights,
  findSectionMatches,
  paintSearchHighlights,
  pickSectionMatch,
  rangeForMatch,
} from './search/epubSearchDom'
import {
  paintReadAloudHighlight,
  rangeForSegment,
  readAloudDataFor,
  textOffsetOfBoundary,
} from './readAloud/epubReadAloudDom'
import {
  epubAnnotationTypeFor,
  pointInIconElement,
  pointInMarkElement,
  styleAttrsFor,
  toOuterRect,
  type MarkedView,
} from './epubjs/annotation-marks'
import {
  displayCfiSafely,
  displayCfiTrusted,
  ensureInitialPaint,
  spineIndexFromCfi,
  waitForRenditionDisplayed,
  withCfiJumpTimeout,
} from './epubjs/display'
import {
  EPUB_VIEW_MANAGER,
  abortError,
  applyDualSpreadHost,
  flowForViewMode,
  readHostLayoutSize,
  spreadForLayout,
  throwIfAborted,
  toArrayBuffer,
  waitForFrames,
  waitForHostSize,
  waitForSectionResources,
} from './epubjs/host-layout'
import {
  currentSectionDocument,
  ePub,
  getEpubCFIConstructor,
  getRenditionLayoutDelta,
  isAtVerticalScrollBoundary,
  renditionManager,
  stopRenditionQueue,
} from './epubjs/rendition-internals'
import {
  basenameLabel,
  buildEpubNavState,
  isCoverSection,
  linkSpineSections,
  normalizeTocItems,
  resolveTocLocationLabel,
  scanSpineCharCounts,
  spineLengthOf,
  type SpineSectionLike,
} from './epubjs/spine'
import {
  DEFAULT_EPUB_READING_STYLE,
  EPUB_BASE_FONT_PX,
  applyEpubFontSize,
  applyEpubReadingStyle,
  applyEpubThemeVars,
  injectEpubThemeStyles,
  type EpubReadingStyle,
} from './epubjs/theme'
import type {
  EpubHighlightClickInfo,
  EpubPageLayout,
  EpubSearchTarget,
  EpubSelectionInfo,
  EpubViewMode,
  EpubjsHandle,
  OpenEpubjsOptions,
  ReadAloudMode,
  ReadAloudSection,
} from './epubjs/types'

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
  let viewMode: EpubViewMode = options.viewMode ?? 'paginated'
  const initialFontSize = options.fontSize ?? EPUB_BASE_FONT_PX
  const initialReadingStyle: EpubReadingStyle = {
    fontFamily: options.fontFamily ?? DEFAULT_EPUB_READING_STYLE.fontFamily,
    fontWeight: options.fontWeight ?? DEFAULT_EPUB_READING_STYLE.fontWeight,
    lineHeight: options.lineHeight ?? DEFAULT_EPUB_READING_STYLE.lineHeight,
    textAlign: options.textAlign ?? DEFAULT_EPUB_READING_STYLE.textAlign,
    marginsEnabled:
      options.marginsEnabled ?? DEFAULT_EPUB_READING_STYLE.marginsEnabled,
    marginPreset: options.marginPreset ?? DEFAULT_EPUB_READING_STYLE.marginPreset,
    chromeHidden: options.chromeHidden ?? DEFAULT_EPUB_READING_STYLE.chromeHidden,
  }
  const initialLocation = options.initialLocation
  const onFirstRender = options.onFirstRender
  const onStatusChange = options.onStatusChange
  const onLocationsReady = options.onLocationsReady

  if (typeof ePub !== 'function') {
    throw new Error('epubjs failed to load (default export is not a function)')
  }

  installEpubjsStartContainerLogFilter()
  throwIfAborted(signal)

  const bytes = toArrayBuffer(buffer)
  if (bytes.byteLength < 22) {
    throw new Error('EPUB payload is empty or truncated')
  }

  const openToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  host.dataset.epubOpen = openToken

  const book = ePub(bytes, { openAs: 'binary' }) as Book
  let rendition: Rendition | null = null
  let activeReadingStyle: EpubReadingStyle = initialReadingStyle
  let settled = false
  let destroyed = false
  let fallbackSpine = 0
  let firstRenderNotified = false
  let resumeCfi: string | undefined
  let resumeSpineIndex: number | undefined

  const notifyFirstRender = () => {
    if (firstRenderNotified || destroyed) return
    if (host.dataset.epubOpen !== openToken) return
    if (!host.querySelector('iframe')) return
    firstRenderNotified = true
    onFirstRender?.()
  }

  const updateStatus = (next: 'opening' | 'rendering' | 'ready') => {
    if (destroyed) return
    onStatusChange?.(next)
  }

  updateStatus('opening')

  const destroyBook = () => {
    if (destroyed) return
    destroyed = true
    // Stop queued start/display before tearing down — see stopRenditionQueue.
    stopRenditionQueue(rendition)
    try {
      rendition?.destroy()
    } catch {
      /* ignore */
    }
    rendition = null
    try {
      // Avoid book.destroy → rendition.destroy recursion after we already cleaned it.
      const bookWithRendition = book as unknown as {
        rendition?: Rendition | null
      }
      bookWithRendition.rendition = null
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
    updateStatus('rendering')
    rendition = book.renderTo(host, {
      width: size.width,
      height: size.height,
      flow: flowForViewMode(viewMode),
      manager: EPUB_VIEW_MANAGER,
      spread: spreadForLayout(layout),
      // Show every spine item in order (cover included when publishers put it in spine).
      allowScriptedContent: false,
    })
    linkSpineSections(book)
    // Apply reading styles before first display so resume CFI paginates with final typography.
    injectEpubThemeStyles(rendition)
    applyEpubThemeVars(rendition, theme)
    applyEpubReadingStyle(rendition, initialReadingStyle)
    applyEpubFontSize(rendition, initialFontSize)
    applyDualSpreadHost(host, layout)
    rendition.on('rendered', notifyFirstRender)
    throwIfAborted(signal)

    // Resume at CFI when provided (T4.1); otherwise first spine item.
    fallbackSpine = 0
    if (initialLocation) {
      try {
        const decoded = cfiCodec.decode(initialLocation) as EpubCfiDecodeResult
        resumeCfi = decoded.cfi
        resumeSpineIndex = spineIndexFromCfi(book, decoded.cfi, fallbackSpine)
        await displayCfiSafely(book, rendition, decoded.cfi, resumeSpineIndex)
      } catch {
        const idx =
          resumeSpineIndex ??
          (resumeCfi
            ? spineIndexFromCfi(book, resumeCfi, fallbackSpine)
            : fallbackSpine)
        await rendition.display(idx)
      }
    } else {
      await rendition.display(fallbackSpine)
    }
    throwIfAborted(signal)
    await ensureInitialPaint(
      host,
      rendition,
      fallbackSpine,
      signal,
      openToken,
      {
        resume: Boolean(initialLocation),
        resumeRetry:
          resumeCfi && resumeSpineIndex != null
            ? { book, cfi: resumeCfi, spineIndex: resumeSpineIndex }
            : undefined,
      },
    )
    notifyFirstRender()
    updateStatus('ready')
  } catch (err) {
    destroyBook()
    throw err
  } finally {
    settled = true
    signal?.removeEventListener('abort', onAbort)
  }

  const paginationTracker = new EpubPaginationTracker(spineLengthOf(book))
  const bookFingerprint = fingerprintEpubBytes(bytes)
  let activeFontSize = initialFontSize
  let paginationMeasureToken = 0
  let paginationAbort: AbortController | null = null

  const readHostSize = () => readHostLayoutSize(host)

  const buildCacheKeyParts = () => {
    const size = readHostSize()
    const keyInput = {
      bookFingerprint,
      spineLength: spineLengthOf(book),
      width: size.width,
      height: size.height,
      layout,
      fontSize: activeFontSize,
      fontFamily: activeReadingStyle.fontFamily,
      fontWeight: activeReadingStyle.fontWeight,
      lineHeight: activeReadingStyle.lineHeight,
      textAlign: activeReadingStyle.textAlign,
      marginsEnabled: activeReadingStyle.marginsEnabled,
      marginPreset: activeReadingStyle.marginPreset,
      chromeHidden: activeReadingStyle.chromeHidden,
    }
    return {
      keyInput,
      key: buildPaginationCacheKey(keyInput),
      layoutFingerprint: buildLayoutFingerprint(keyInput),
    }
  }

  const publishLocationsReady = () => {
    if (destroyed || signal?.aborted) return
    onLocationsReady?.()
  }

  const hydrateFromCache = async (): Promise<boolean> => {
    const { key } = buildCacheKeyParts()
    const cached = await readPaginationCache(key)
    if (destroyed || signal?.aborted) return false
    if (!cached) return false
    if (cached.spineLength !== spineLengthOf(book)) return false
    if (cached.sectionPages.length !== spineLengthOf(book)) return false
    paginationTracker.hydrateExactSectionPages(cached.sectionPages)
    publishLocationsReady()
    return true
  }

  const startHiddenPaginationMeasure = () => {
    if (destroyed || signal?.aborted) return

    const token = ++paginationMeasureToken
    paginationAbort?.abort()
    const localAbort = new AbortController()
    paginationAbort = localAbort

    const onParentAbort = () => localAbort.abort()
    signal?.addEventListener('abort', onParentAbort, { once: true })

    void (async () => {
      try {
        const hit = await hydrateFromCache()
        if (hit || destroyed || signal?.aborted || token !== paginationMeasureToken) {
          return
        }

        const size = readHostSize()
        if (size.width <= 0 || size.height <= 0) return

        const { measureHiddenEpubPagination } = await import(
          './progress/hidden-epub-pagination'
        )
        if (destroyed || signal?.aborted || token !== paginationMeasureToken) {
          return
        }

        const result = await measureHiddenEpubPagination({
          buffer: bytes,
          width: size.width,
          height: size.height,
          theme,
          layout,
          fontSize: activeFontSize,
          readingStyle: { ...activeReadingStyle },
          signal: localAbort.signal,
        })

        if (destroyed || signal?.aborted || token !== paginationMeasureToken) {
          return
        }
        if (result.spineLength !== spineLengthOf(book)) return

        paginationTracker.hydrateExactSectionPages(result.sectionPages)
        const { key, layoutFingerprint } = buildCacheKeyParts()
        await writePaginationCache({
          key,
          bookFingerprint,
          layoutFingerprint,
          spineLength: result.spineLength,
          sectionPages: result.sectionPages,
        })
        publishLocationsReady()
      } catch (err) {
        if (destroyed || signal?.aborted || localAbort.signal.aborted) return
        console.warn('[epub pagination] hidden measure failed', err)
      } finally {
        signal?.removeEventListener('abort', onParentAbort)
        if (paginationAbort === localAbort) paginationAbort = null
      }
    })()
  }

  // Prefer cached totals immediately; measure in a hidden rendition on miss.
  void hydrateFromCache().then((hit) => {
    if (destroyed || signal?.aborted) return
    if (!hit) startHiddenPaginationMeasure()
  })

  // Scan section text lengths in the background to seed character counts & page estimates
  void scanSpineCharCounts(book, signal)
    .then((charCounts) => {
      if (destroyed || signal?.aborted) return
      paginationTracker.initCharCounts(charCounts)
      if (!paginationTracker.isFullyMeasured()) {
        publishLocationsReady()
      }
    })
    .catch(() => {
      /* ignore */
    })

  const activeRendition = rendition
  if (!activeRendition) {
    destroyBook()
    throw new Error('EPUB rendition failed to start')
  }

  let lastSelectionWindow: Window | null = null
  let selectionCb: ((info: EpubSelectionInfo | null) => void) | null = null



  /**
   * A `strikethrough` mark is really an `underline` mark under the hood (see
   * `epubAnnotationTypeFor`) — marks-pane's `Underline.render()` (marks-pane/src/marks.js)
   * hardcodes its `<line>` at the BOTTOM of each line box, which is exactly what we want for a
   * real underline but not for a strikethrough. There's no library hook to change that, so this
   * walks the mark's own `<rect>`/`<line>` child pairs afterward and moves each `<line>` to the
   * vertical middle of its sibling `<rect>` instead. Re-run on every `rendered` view (alongside
   * `applyFocusedMarkClass`) since marks-pane recreates this geometry from scratch each time.
   */
  const strikethroughCfiRanges = new Set<string>()
  function repositionStrikethroughLines(): void {
    if (strikethroughCfiRanges.size === 0) return
    const views = activeRendition.views() as unknown as {
      forEach: (cb: (view: MarkedView) => void) => void
    }
    views.forEach((view) => {
      for (const cfiRange of strikethroughCfiRanges) {
        const element = view.underlines?.[cfiRange]?.element
        if (!element) continue
        let rect: SVGRectElement | null = null
        for (const child of Array.from(element.children)) {
          if (child.tagName === 'rect') {
            rect = child as SVGRectElement
          } else if (child.tagName === 'line' && rect) {
            const y = Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2
            child.setAttribute('y1', String(y))
            child.setAttribute('y2', String(y))
            rect = null
          }
        }
      }
    })
  }

  function applyHighlight({
    id,
    cfiRange,
    styleKind,
    colorHex,
  }: {
    id: string
    cfiRange: string
    styleKind: HighlightStyleKind
    colorHex: string
  }): void {
    const epubType = epubAnnotationTypeFor(styleKind)
    // Remove first: re-applying the same (cfiRange, type) after a color/style change, or a
    // duplicate load-on-open call, must replace the mark rather than leak a second DOM node.
    // Separate try/catch from the add() below — remove() failing (it shouldn't; epub.js no-ops
    // when the mark isn't found) must never block add() from still painting the highlight.
    try {
      activeRendition.annotations.remove(cfiRange, epubType)
    } catch {
      /* ignore */
    }
    strikethroughCfiRanges.delete(cfiRange)
    try {
      if (epubType === 'mark') {
        activeRendition.annotations.add('mark', cfiRange, { id })
      } else {
        activeRendition.annotations.add(
          epubType,
          cfiRange,
          { id },
          undefined,
          undefined,
          styleAttrsFor(styleKind, colorHex),
        )
      }
    } catch {
      /* stale/foreign cfi — ignore */
    }
    if (styleKind === 'strikethrough') strikethroughCfiRanges.add(cfiRange)
    // Re-apply the focused outline (and strikethrough line position) in case this mark is the
    // currently-focused one — e.g. a brand-new highlight created while already "focused" (see
    // `createHighlight` in useReaderHighlights.ts), whose element didn't exist yet the moment
    // `setFocusedHighlight` was called.
    applyFocusedMarkClass()
    repositionStrikethroughLines()
  }

  function removeHighlight(cfiRange: string, styleKind: HighlightStyleKind): void {
    if (styleKind === 'strikethrough') strikethroughCfiRanges.delete(cfiRange)
    try {
      activeRendition.annotations.remove(cfiRange, epubAnnotationTypeFor(styleKind))
    } catch {
      /* ignore */
    }
  }

  /** Finds the live mark epub.js/marks-pane painted for `cfiRange` — undocumented internals
   *  (`view.highlights`/`view.underlines`/`view.marks`, keyed by cfiRange) reached the same way
   *  `Annotations.remove` reaches `view.unhighlight`/`view.ununderline`/`view.unmark` upstream.
   *  Only ever populated for the section currently rendered as a view, so most lookups just miss. */
  function findMarkElement(cfiRange: string, styleKind: HighlightStyleKind): Element | null {
    const storeKey: 'highlights' | 'underlines' | 'marks' =
      styleKind === 'underline' || styleKind === 'strikethrough'
        ? 'underlines'
        : styleKind === 'textbox'
          ? 'marks'
          : 'highlights'
    let found: Element | null = null
    const views = activeRendition.views() as unknown as {
      forEach: (cb: (view: MarkedView) => void) => void
    }
    views.forEach((view) => {
      if (found) return
      const entry = view[storeKey]?.[cfiRange]
      if (entry?.element) found = entry.element
    })
    return found
  }

  /** Pulses a mark's opacity a few times — used when jumping to a highlight from the sidebar so
   *  it's obvious which one the reader landed on when several marks share the same viewport. */
  function flashHighlight(cfiRange: string, styleKind: HighlightStyleKind): void {
    const element = findMarkElement(cfiRange, styleKind)
    if (!element) return
    try {
      element.animate(
        [{ opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }],
        { duration: 900, easing: 'ease-in-out' },
      )
    } catch {
      /* Element.animate unavailable — the mark just won't pulse */
    }
  }


  function getHighlightAtPoint(outerX: number, outerY: number): EpubHighlightClickInfo | null {
    let found: EpubHighlightClickInfo | null = null
    const views = activeRendition.views() as unknown as {
      forEach: (cb: (view: MarkedView) => void) => void
    }
    views.forEach((view) => {
      if (found) return
      for (const store of [view.highlights, view.underlines]) {
        if (!store || found) continue
        for (const cfiRange in store) {
          const element = store[cfiRange]?.element
          const id = element?.getAttribute('data-id')
          if (!element || !id || !pointInMarkElement(element, outerX, outerY)) continue
          const rect = element.getBoundingClientRect()
          found = {
            id,
            cfiRange,
            rect: {
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            },
          }
          break
        }
      }
      if (found || !view.marks) return
      for (const cfiRange in view.marks) {
        const element = view.marks[cfiRange]?.element
        const id = element?.dataset.id
        if (!element || !id || !pointInIconElement(element, outerX, outerY)) continue
        const rect = element.getBoundingClientRect()
        found = {
          id,
          cfiRange,
          rect: {
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
        }
        break
      }
    })
    return found
  }

  let focusedMarkId: string | null = null
  function applyFocusedMarkClass(): void {
    const views = activeRendition.views() as unknown as {
      forEach: (cb: (view: MarkedView) => void) => void
    }
    views.forEach((view) => {
      for (const store of [view.highlights, view.underlines]) {
        if (!store) continue
        for (const cfiRange in store) {
          const element = store[cfiRange]?.element
          if (!element) continue
          element.classList.toggle(
            'rb-hl-focused',
            focusedMarkId != null && element.getAttribute('data-id') === focusedMarkId,
          )
        }
      }
      if (!view.marks) return
      for (const cfiRange in view.marks) {
        const element = view.marks[cfiRange]?.element
        if (!element) continue
        element.classList.toggle('rb-hl-focused', focusedMarkId != null && element.dataset.id === focusedMarkId)
      }
    })
  }

  function setFocusedHighlight(id: string | null): void {
    focusedMarkId = id
    applyFocusedMarkClass()
  }

  /**
   * epub.js's own `selected` event (below) only fires while a selection is being made or
   * extended — its underlying `selectionchange` handler in `Contents` explicitly skips
   * collapsed selections (see `contents.js`'s `triggerSelectedEvent`), so it never reports a
   * selection being *cleared*. A left click that collapses the current selection (without
   * starting a new one) would otherwise leave `onTextSelected`'s last non-null value — and the
   * floating toolbar — stuck on screen indefinitely. Watch `selectionchange` directly on
   * whichever section document last reported a real selection, and report a collapse the
   * moment it happens instead of waiting on a selection that will never come.
   */
  let selectionChangeDoc: Document | null = null
  const handleDocSelectionChange = () => {
    if (!selectionCb) return
    const sel = selectionChangeDoc?.defaultView?.getSelection()
    const collapsed = !sel || sel.rangeCount === 0 || sel.getRangeAt(0).collapsed || !sel.toString().trim()
    if (collapsed) selectionCb(null)
  }
  function trackSelectionChangeDoc(doc: Document | null) {
    if (doc === selectionChangeDoc) return
    selectionChangeDoc?.removeEventListener('selectionchange', handleDocSelectionChange)
    selectionChangeDoc = doc
    selectionChangeDoc?.addEventListener('selectionchange', handleDocSelectionChange)
  }

  /** Track the iframe window that last reported a text selection, for `clearSelection`. */
  const handleSelected = (
    cfiRange: string,
    contents: { document?: Document; window?: Window },
  ) => {
    const win = contents.window ?? contents.document?.defaultView ?? null
    if (win) lastSelectionWindow = win
    trackSelectionChangeDoc(contents.document ?? win?.document ?? null)
    if (!selectionCb) return

    const sel = win?.getSelection()
    const text = sel?.toString()?.trim() ?? ''
    const iframe = host.querySelector('iframe')
    if (!text || !sel || sel.rangeCount === 0 || !iframe || !win) {
      selectionCb(null)
      return
    }
    const range = sel.getRangeAt(0)
    const localRect = range.getBoundingClientRect()
    if (localRect.width === 0 && localRect.height === 0) {
      selectionCb(null)
      return
    }
    selectionCb({ cfiRange, text, rect: toOuterRect(localRect, iframe, win), lang: selectionLang(range) })
  }

  const selectionLang = (range: Range): string => {
    const container = range.commonAncestorContainer
    const start = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement
    for (let el: Element | null = start; el; el = el.parentElement) {
      const lang = el.getAttribute('lang') || el.getAttribute('xml:lang')
      if (lang) return lang.trim()
    }
    const metadata = (book as unknown as { packaging?: { metadata?: { language?: unknown } } })
      .packaging?.metadata
    return typeof metadata?.language === 'string' ? metadata.language.trim() : ''
  }

  /**
   * Synchronous read of whatever text selection is live right now, bypassing epub.js's own
   * `selected` event entirely — that event only fires ~250ms after the selection *stops
   * changing*, which is fine for the right-click-menu/translate bookkeeping (`pendingSelection`)
   * but wrong for "commit the highlight the instant the mouse button comes up": at that exact
   * moment the debounced event may not have fired yet (a fast drag-release), or may be about to
   * fire again for a stale mid-drag extent. `EpubRenderer`'s pointerup handler calls this directly
   * instead of trusting whatever `onTextSelected` last delivered.
   */
  const getCurrentSelectionInfo = (): EpubSelectionInfo | null => {
    const contents = activeRendition.getContents() as unknown as
      | Array<{ document?: Document; window?: Window; sectionIndex?: number }>
      | undefined
    const EpubCFI = getEpubCFIConstructor()
    if (!EpubCFI) return null
    for (const content of contents ?? []) {
      const doc = content.document
      const win = content.window ?? doc?.defaultView ?? null
      if (!doc || !win) continue
      const sel = win.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) continue
      const text = sel.toString().trim()
      if (!text) continue
      const range = sel.getRangeAt(0)
      const localRect = range.getBoundingClientRect()
      if (localRect.width === 0 && localRect.height === 0) continue
      const iframe = (win.frameElement as HTMLIFrameElement | null) ?? host.querySelector('iframe')
      if (!iframe) continue
      const section =
        typeof content.sectionIndex === 'number'
          ? (book.spine.get(content.sectionIndex) as unknown as { cfiBase?: string } | undefined)
          : undefined
      if (typeof section?.cfiBase !== 'string') continue
      let cfiRange: string
      try {
        cfiRange = new EpubCFI(range, section.cfiBase).toString()
      } catch {
        continue
      }
      return { cfiRange, text, rect: toOuterRect(localRect, iframe, win), lang: selectionLang(range) }
    }
    return null
  }

  activeRendition.on('selected', handleSelected)
  activeRendition.on('rendered', applyFocusedMarkClass)
  activeRendition.on('rendered', repositionStrikethroughLines)
  // A view's `reframe()` (iframe.js) calls `pane.render()` directly whenever it resizes — e.g.
  // once images/fonts finish loading right after the initial `rendered` fires — which rebuilds
  // every underline's <line> from scratch at marks-pane's hardcoded bottom position, undoing the
  // reposition above. `resized` fires after those internal re-renders settle, so re-run there too.
  activeRendition.on('resized', repositionStrikethroughLines)

  /**
   * `activeRendition.resize()` and `activeRendition.display()` both mutate
   * the same epub.js ViewManager (clear views, re-measure columns, restore a
   * location). Two such calls running back-to-back — e.g. the host's
   * ResizeObserver firing `resizeToHost()` while a `goToLocation()` jump's
   * own display()/settle sequence is still in flight, which is exactly what
   * happens when chrome hides/shows or a sidebar opens right as the user
   * clicks "jump" — leave the manager's view list inconsistent
   * (stale column width / page height, split-column layout — see
   * docs/note/jump-to-location-bugfix-plan.md §3). `cancelResizeAnchor()`
   * only invalidates a pending *settle correction*; it does not stop a fresh
   * `resize()`/`display()` call from firing concurrently. Route every such
   * call through this queue instead so they run strictly one at a time — a
   * caller that arrives mid-operation just waits its turn rather than racing
   * it. The queue itself never rejects, so one failed op never wedges future
   * callers; each caller still observes its own call's rejection.
   */
  let renditionQueue: Promise<void> = Promise.resolve()
  function withRenditionLock<T>(run: () => T | Promise<T>): Promise<T> {
    const result = renditionQueue.then(run)
    renditionQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  let resizeAnchorToken = 0

  /**
   * Drop any pending anchor restore. Navigation that lands inside the *same*
   * section (a page turn, a page-scrub jump, a viewport scroll) is invisible to
   * the spine guard below, so every nav entry point must disown the anchor
   * explicitly or a late settle would yank the reader back.
   */
  const cancelResizeAnchor = () => {
    resizeAnchorToken += 1
  }

  /**
   * epub.js measures the anchor CFI's offset while the section it just
   * re-rendered is still reflowing, so the restore it runs from `resize()`
   * lands at the start of the section instead of the real position:
   * `view.locationOf()` resolves to a zero offset that `moveTo()` floors down
   * to column 0 — page 1 of the spine section. Wait for that layout to settle,
   * then re-issue the same display:
   * the section is already mounted, so epub.js takes its "already shown" fast
   * path and recomputes the offset against the now-stable layout — the same
   * correction `goToLocation` makes for jumps.
   */
  const settleResizeAnchor = async (cfi: string): Promise<void> => {
    const token = (resizeAnchorToken += 1)
    const anchorSpine = spineIndexFromCfi(book, cfi, fallbackSpine)
    // Let epub.js's own resize-triggered display() finish first — see
    // waitForRenditionDisplayed.
    await waitForRenditionDisplayed(activeRendition)
    if (token !== resizeAnchorToken) return
    await waitForSectionResources(currentSectionDocument(activeRendition))
    await waitForFrames(2)
    // A newer resize owns the position now.
    if (token !== resizeAnchorToken) return
    // A TOC jump / page nav landed elsewhere while the layout settled — that
    // is the reader's intent, so never drag them back to the pre-resize spot.
    if (currentSpineIndex() !== anchorSpine) return
    try {
      await displayCfiTrusted(activeRendition, cfi, anchorSpine)
      await waitForFrames(2)
      if (token !== resizeAnchorToken) return
      activeRendition.reportLocation()
    } catch {
      /* rendition torn down mid-resize */
    }
  }

  /**
   * `manager.resize()` clears every view and scrolls the container back to the
   * top, then restores the reading position from `rendition.location.start.cfi`
   * — the very field `readRenditionLocation()` exists to work around, because
   * epub.js does not always keep it populated. When it is empty nothing
   * restores the scroll and the reader silently lands at the start of the book,
   * so resolve the anchor CFI here and hand it to epub.js explicitly.
   */
  const resizeToHost = (intent: 'preserve' | 'reflow' = 'preserve') => {
    const { width, height } = readHostLayoutSize(host)
    if (width <= 0 || height <= 0) return

    // `reflow` is the mid-navigation recovery resize: the caller is about to
    // move the reader itself, so pinning the pre-resize position would fight
    // the turn it is trying to unstick.
    if (intent === 'reflow') {
      cancelResizeAnchor()
      void withRenditionLock(() => {
        activeRendition.resize(width, height)
      })
      return
    }

    const anchorCfi = cfiFromLocation(readRenditionLocation())
    void withRenditionLock(async () => {
      // epub.js accepts a third `epubcfi` restore anchor that its bundled
      // typings omit.
      const resizeWithAnchor = activeRendition as unknown as {
        resize: (width: number, height: number, epubcfi?: string) => void
      }
      resizeWithAnchor.resize(width, height, anchorCfi || undefined)
      // Settle runs under the same lock slot as the resize that scheduled it,
      // so a second resize/jump queued behind this call only starts once the
      // correction below has actually finished (or bailed via the token
      // check) — never mid-correction.
      if (anchorCfi) await settleResizeAnchor(anchorCfi)
      else cancelResizeAnchor()
    })
  }

  const getSpineLength = () => spineLengthOf(book)
  const hasSpineCover = () => {
    const length = spineLengthOf(book)
    for (let index = 0; index < length; index += 1) {
      const section = book.spine.get(index) as SpineSectionLike | undefined
      if (isCoverSection(section, book)) return true
    }
    return false
  }
  const getToc = () =>
    normalizeTocItems(
      (book as unknown as { navigation?: { toc?: unknown } }).navigation?.toc,
    )

  const getSectionLabels = (): string[] => {
    const toc = getToc()
    return Array.from({ length: spineLengthOf(book) }, (_, index) => {
      const href = book.spine.get(index)?.href ?? ''
      return (
        resolveTocLocationLabel(href, toc) ||
        (href ? basenameLabel(href) : '') ||
        `Section ${index + 1}`
      )
    })
  }

  const currentSpineIndex = (): number => {
    const start = activeRendition.location?.start
    if (start && typeof start.index === 'number') return start.index
    return 0
  }

  // `getSectionLabels()` walks the whole TOC once per call; the excerpt
  // cache needs a label per lookup, so memoize the array once (the TOC
  // never changes across a book's open lifetime) instead of recomputing it
  // per spine index.
  let sectionLabelsCache: string[] | null = null
  const sectionLabelsOnce = (): string[] => {
    if (!sectionLabelsCache) sectionLabelsCache = getSectionLabels()
    return sectionLabelsCache
  }
  const spineExcerptCache = createSpineExcerptCache(book, {
    getLabel: (index) => sectionLabelsOnce()[index] ?? `Section ${index + 1}`,
    excludeIndex: currentSpineIndex,
  })

  const goToSpineIndex = async (index: number) => {
    const n = spineLengthOf(book)
    if (n <= 0) return
    cancelResizeAnchor()
    const clamped = Math.min(Math.max(Math.round(index), 0), n - 1)
    await activeRendition.display(clamped)
  }

  const goToHref = async (href: string) => {
    if (!href) return
    cancelResizeAnchor()
    await activeRendition.display(href)
  }

  const readRenditionLocation = (): unknown => {
    const prop = activeRendition.location
    if (prop?.start) return prop
    const method = (
      activeRendition as unknown as {
        currentLocation?: () => unknown
      }
    ).currentLocation
    if (typeof method === 'function') {
      try {
        return method.call(activeRendition)
      } catch {
        return undefined
      }
    }
    return prop
  }

  const goToLocationPage = async (page: number) => {
    cancelResizeAnchor()
    const { spineIndex, sectionPage } = paginationTracker.resolveTargetPage(page)
    const currentSpine = currentSpineIndex()
    const displayed = currentDisplayedBoundary()
    const currentSectionP = displayed?.page ?? 1
    const delta = getRenditionLayoutDelta(activeRendition)

    const moveRenditionToOffset = (left: number) => {
      const targetRendition = activeRendition as unknown as {
        moveTo?: (offset: { top: number; left: number }) => void
      }
      targetRendition.moveTo?.({ top: 0, left })
    }

    if (spineIndex === currentSpine) {
      if (sectionPage === currentSectionP) return
      if (delta > 0) {
        moveRenditionToOffset((sectionPage - 1) * delta)
        await waitForFrames(2)
        activeRendition.reportLocation()
      }
      return
    }

    await activeRendition.display(spineIndex)
    await waitForFrames(2)
    if (sectionPage > 1) {
      const updatedDelta = getRenditionLayoutDelta(activeRendition) || delta
      if (updatedDelta > 0) {
        moveRenditionToOffset((sectionPage - 1) * updatedDelta)
        await waitForFrames(2)
        activeRendition.reportLocation()
      }
    }
  }

  const getCurrentLocation = (): CfiLocation | undefined =>
    tryEncodeCfi(readRenditionLocation())

  const getCurrentExcerpt = (): string | undefined => {
    const doc = currentSectionDocument(activeRendition)
    if (!doc) return undefined
    const excerpt = extractExcerpt(doc, EXCERPT_MAX_CHARS)
    return excerpt || undefined
  }

  const goToLocation = async (location: CfiLocation): Promise<void> => {
    cancelResizeAnchor()
    const decoded = cfiCodec.decode(location) as EpubCfiDecodeResult
    const fallbackSpine = currentSpineIndex()
    // Resolve the target spine index up front (outside the lock, no
    // epub.js call yet) so the forced-reload step below has it ready.
    const targetDisplayCfi = toEpubjsDisplayCfi(decoded.cfi)
    const targetIndex = targetDisplayCfi
      ? spineIndexFromCfi(book, targetDisplayCfi, fallbackSpine)
      : fallbackSpine
    // Whole sequence — including the fallback catch below — runs under the
    // shared rendition lock (see its declaration) so a resize racing this
    // jump (chrome hide/show, sidebar toggle) queues behind it instead of
    // mutating the ViewManager concurrently.
    await withRenditionLock(async () => {
      await withCfiJumpTimeout(async () => {
        // Force a fresh full-section (re)load by spine index before
        // landing on the precise CFI offset, even when the target section
        // is already mounted — an already-mounted section takes epub.js's
        // "already shown" fast path on the calls below, which reuses that
        // section's cached column-width/page-height instead of
        // recomputing it against the host's CURRENT size.
        await withEpubjsStartContainerLogMutedAsync(() =>
          activeRendition.display(targetIndex),
        )
        await displayCfiSafely(book, activeRendition, decoded.cfi, fallbackSpine)
        // epub.js computes the CFI's on-page offset (view.locationOf / column
        // math) right after the target section is attached to the DOM — before the
        // browser has finished reflow (fonts/images/layout) — so the first jump often
        // lands at the top of the section instead of the real offset, which is why
        // deep-linking into an annotation reads as "always jumps to the top of the
        // chapter". A manual second jump
        // "fixes" it because the section's layout has settled by then; wait for that
        // settle, then re-issue the same display(): the section is already mounted, so
        // epub.js takes its "already shown" fast path, recomputes the position against
        // the now-stable layout — the same effect as the manual second click, for free.
        await waitForSectionResources(currentSectionDocument(activeRendition))
        await waitForFrames(2)
        await displayCfiSafely(book, activeRendition, decoded.cfi, fallbackSpine)
        await waitForFrames(2)
        activeRendition.reportLocation()
      })
    })
  }

  // --- In-book search (see search/epubSearchDom.ts) -------------------------------------------

  let searchMatcher: TextMatcher | null = null
  /** The match last jumped to; `spineIndex` because a CFI's in-document path resolves in ANY doc. */
  let searchCurrent: { spineIndex: number; cfi: string } | null = null

  /**
   * Repaint hits in every mounted section view. Cheap: re-matches ~one chapter of text.
   *
   * Wrapped in try/catch per section: this runs on epub.js's `rendered` event, on the SAME
   * rendition `EpubRenderer.tsx` later registers its own `rendered` listener on (the one that
   * calls `attachFrameListeners` to wire up `contextmenu`/`pointerdown` for the new section's
   * iframe — see `attachOnRendered` there). epub.js's emitter runs listeners for one event in
   * registration order with no isolation between them, and this one is registered first (inside
   * `openEpubjs`, before the handle is even returned to the caller). An uncaught throw here — a
   * malformed section's text/CFI, a document mid-teardown — would propagate out of `emit()` and
   * skip every listener registered after it for that same event, silently leaving the new
   * section's right-click/drag-to-select handlers never attached with no error visible at the
   * call site that looks broken.
   */
  const applySearchHighlights = () => {
    const contents = activeRendition.getContents() as unknown as
      | Array<{ document?: Document; sectionIndex?: number }>
      | undefined
    const EpubCFI = getEpubCFIConstructor()
    for (const content of contents ?? []) {
      const doc = content.document
      if (!doc) continue
      try {
        if (!searchMatcher) {
          clearSearchHighlights(doc)
          continue
        }
        const { index, matches } = findSectionMatches(doc, searchMatcher)
        const ranges = matches
          .map((match) => rangeForMatch(doc, index, match))
          .filter((range): range is Range => range !== null)
        let current: Range | null = null
        if (searchCurrent && EpubCFI && searchCurrent.spineIndex === content.sectionIndex) {
          try {
            current = new EpubCFI(searchCurrent.cfi).toRange(doc)
          } catch {
            current = null
          }
        }
        paintSearchHighlights(doc, ranges, current)
      } catch (err) {
        console.error('[epub] applySearchHighlights failed for a section', err)
      }
    }
  }
  activeRendition.on('rendered', applySearchHighlights)

  /** Run `read` on the section's document: the live one when mounted, else an off-DOM load. */
  const withSectionDocument = async <T,>(
    spineIndex: number,
    read: (doc: Document, cfiBase: string) => T,
  ): Promise<T | null> => {
    const section = book.spine.get(spineIndex) as unknown as
      | {
          cfiBase?: string
          document?: Document
          load: (request?: (url: string) => Promise<unknown>) => Promise<unknown>
          unload: () => void
        }
      | undefined
    if (!section || typeof section.cfiBase !== 'string') return null

    const contents = activeRendition.getContents() as unknown as
      | Array<{ document?: Document; sectionIndex?: number }>
      | undefined
    const live = contents?.find((c) => c.sectionIndex === spineIndex)?.document
    if (live) return read(live, section.cfiBase)

    try {
      await section.load(book.load.bind(book))
      return section.document ? read(section.document, section.cfiBase) : null
    } catch {
      return null
    } finally {
      // Same rule as the excerpt cache: never unload a section that became the displayed one.
      if (currentSpineIndex() !== spineIndex) {
        try {
          section.unload()
        } catch {
          /* best-effort cleanup only */
        }
      }
    }
  }

  const setSearchHighlights = (matcher: TextMatcher | null) => {
    searchMatcher = matcher
    // A new hit set never inherits the previous query's "current" hit; goToSearchMatch sets it.
    searchCurrent = null
    applySearchHighlights()
  }

  const goToSearchMatch = async (target: EpubSearchTarget): Promise<boolean> => {
    const matcher = searchMatcher
    const EpubCFI = getEpubCFIConstructor()
    const cfi =
      matcher && EpubCFI
        ? await withSectionDocument(target.spineIndex, (doc, cfiBase) => {
            const { index, matches } = findSectionMatches(doc, matcher)
            const match = pickSectionMatch(matches, target.occurrence, target.count)
            const range = match ? rangeForMatch(doc, index, match) : null
            return range ? new EpubCFI(range, cfiBase).toString() : null
          })
        : null

    if (!cfi) {
      // Text not found in the rendered markup — at least open the right chapter.
      searchCurrent = null
      await goToSpineIndex(target.spineIndex)
      applySearchHighlights()
      return false
    }
    searchCurrent = { spineIndex: target.spineIndex, cfi }
    await goToLocation(new CfiLocation(cfi))
    applySearchHighlights()
    return true
  }

  // --- Read aloud (see readAloud/epubReadAloudDom.ts) -----------------------------------------

  let readAloudCursor: { spineIndex: number; index: number } | null = null

  const liveSectionDocument = (spineIndex: number): Document | null => {
    const contents = activeRendition.getContents() as unknown as
      | Array<{ document?: Document; sectionIndex?: number }>
      | undefined
    return contents?.find((c) => c.sectionIndex === spineIndex)?.document ?? null
  }

  const readAloudLang = (doc: Document): string => {
    const metadata = (book as unknown as { packaging?: { metadata?: { language?: unknown } } })
      .packaging?.metadata
    const bookLang = typeof metadata?.language === 'string' ? metadata.language : ''
    return (
      doc.documentElement.getAttribute('lang') ||
      doc.documentElement.getAttribute('xml:lang') ||
      bookLang ||
      navigator.language
    ).trim()
  }

  /** Text offsets of the visible range's start/end in `doc`, from epub.js's located CFIs. */
  const visibleTextBounds = (
    doc: Document,
    index: Parameters<typeof textOffsetOfBoundary>[1],
  ): { start: number; end: number } | null => {
    const EpubCFI = getEpubCFIConstructor()
    const location = readRenditionLocation() as
      | { start?: { cfi?: string }; end?: { cfi?: string } }
      | undefined
    const startCfi = location?.start?.cfi
    const endCfi = location?.end?.cfi
    if (!EpubCFI || !startCfi || !endCfi) return null
    const toRange = (cfi: string): Range | null => {
      try {
        return new EpubCFI(cfi).toRange(doc) ?? resolveCfiRange(doc, cfi)
      } catch {
        return resolveCfiRange(doc, cfi)
      }
    }
    const startRange = toRange(startCfi)
    const endRange = toRange(endCfi)
    if (!startRange || !endRange) return null
    return {
      start: textOffsetOfBoundary(doc, index, startRange.startContainer, startRange.startOffset),
      end: textOffsetOfBoundary(doc, index, endRange.endContainer, endRange.endOffset),
    }
  }

  /** Same isolation rationale as `applySearchHighlights` above — never let a bad section block
   *  `EpubRenderer.tsx`'s own `rendered` listener (`attachOnRendered`) that wires up
   *  right-click/drag-to-select for the newly rendered section. */
  const applyReadAloudHighlight = () => {
    const contents = activeRendition.getContents() as unknown as
      | Array<{ document?: Document; sectionIndex?: number }>
      | undefined
    for (const content of contents ?? []) {
      const doc = content.document
      if (!doc) continue
      try {
        if (!readAloudCursor || readAloudCursor.spineIndex !== content.sectionIndex) {
          paintReadAloudHighlight(doc, null)
          continue
        }
        const data = readAloudDataFor(doc, readAloudLang(doc))
        paintReadAloudHighlight(doc, rangeForSegment(doc, data, readAloudCursor.index))
      } catch (err) {
        console.error('[epub] applyReadAloudHighlight failed for a section', err)
      }
    }
  }
  activeRendition.on('rendered', applyReadAloudHighlight)

  const getReadAloudSegments = (mode: ReadAloudMode): ReadAloudSection | null => {
    const spineIndex = currentSpineIndex()
    const doc = liveSectionDocument(spineIndex)
    if (!doc) return null
    const lang = readAloudLang(doc)
    const data = readAloudDataFor(doc, lang)
    const segments = data.segments.map((s) => s.text)
    let startIndex = 0
    let endIndex = segments.length
    if (mode !== 'section') {
      const bounds = visibleTextBounds(doc, data.index)
      if (bounds) {
        const first = data.segments.findIndex((s) => s.end > bounds.start)
        startIndex = first < 0 ? segments.length : first
        if (mode === 'viewport') {
          const after = data.segments.findIndex((s) => s.start >= bounds.end)
          endIndex = Math.max(startIndex, after < 0 ? segments.length : after)
        }
      }
    }
    return { spineIndex, lang, segments, startIndex, endIndex }
  }

  /** 'elsewhere' = another section is displayed, or the reader paged away from the segment. */
  const readAloudSegmentPlacement = (
    spineIndex: number,
    index: number,
  ): 'visible' | 'after' | 'elsewhere' => {
    if (currentSpineIndex() !== spineIndex) return 'elsewhere'
    const doc = liveSectionDocument(spineIndex)
    if (!doc) return 'elsewhere'
    const data = readAloudDataFor(doc, readAloudLang(doc))
    const segment = data.segments[index]
    const bounds = visibleTextBounds(doc, data.index)
    // Can't tell where the view is — leave it alone rather than jump around.
    if (!segment || !bounds) return 'visible'
    if (segment.start < bounds.end && segment.end > bounds.start) return 'visible'
    return segment.start >= bounds.end ? 'after' : 'elsewhere'
  }

  const jumpToReadAloudSegment = async (spineIndex: number, index: number) => {
    if (currentSpineIndex() !== spineIndex) await goToSpineIndex(spineIndex)
    const doc = liveSectionDocument(spineIndex)
    const section = book.spine.get(spineIndex) as unknown as { cfiBase?: string } | undefined
    const EpubCFI = getEpubCFIConstructor()
    if (!doc || !EpubCFI || typeof section?.cfiBase !== 'string') return
    const range = rangeForSegment(doc, readAloudDataFor(doc, readAloudLang(doc)), index)
    if (range) await goToLocation(new CfiLocation(new EpubCFI(range, section.cfiBase).toString()))
  }

  /** Normal follow is one page turn; anything further (reader navigated away) is a direct jump. */
  const revealReadAloudSegment = async (spineIndex: number, index: number) => {
    let placement = readAloudSegmentPlacement(spineIndex, index)
    if (placement === 'visible') return
    if (placement === 'after') {
      await nextPage()
      placement = readAloudSegmentPlacement(spineIndex, index)
      if (placement === 'visible') return
    }
    await jumpToReadAloudSegment(spineIndex, index)
  }

  const setReadAloudCursor = async (cursor: { spineIndex: number; index: number } | null) => {
    readAloudCursor = cursor
    applyReadAloudHighlight()
    if (!cursor) return
    await revealReadAloudSegment(cursor.spineIndex, cursor.index)
    // A page turn into a freshly rendered view needs the highlight re-applied.
    if (readAloudCursor === cursor) applyReadAloudHighlight()
  }

  // Keep teardown on abort: this runs after `settled`, so onAbort no longer destroys.
  try {
    if (initialLocation) {
      const decoded = cfiCodec.decode(initialLocation) as EpubCfiDecodeResult
      const resumeSpineIndex = spineIndexFromCfi(
        book,
        decoded.cfi,
        fallbackSpine,
      )
      await ensureInitialPaint(
        host,
        activeRendition,
        fallbackSpine,
        signal,
        openToken,
        {
          resume: true,
          resumeRetry: {
            book,
            cfi: decoded.cfi,
            spineIndex: resumeSpineIndex,
          },
        },
      )
    }
  } catch (err) {
    destroyBook()
    throw err
  }

  const currentLocationSignature = (): string => {
    const start = (
      readRenditionLocation() as
        | {
            start?: {
              index?: number
              cfi?: string
              displayed?: { page?: number; total?: number }
            }
          }
        | undefined
    )?.start
    return JSON.stringify({
      index: start?.index,
      cfi: start?.cfi,
      page: start?.displayed?.page,
      total: start?.displayed?.total,
    })
  }

  const currentDisplayedBoundary = (): {
    page: number
    total: number
  } | null => {
    const displayed = (
      readRenditionLocation() as
        | {
            start?: {
              displayed?: { page?: number; total?: number }
            }
          }
        | undefined
    )?.start?.displayed
    if (
      typeof displayed?.page !== 'number' ||
      !Number.isFinite(displayed.page) ||
      typeof displayed.total !== 'number' ||
      !Number.isFinite(displayed.total) ||
      displayed.page < 1 ||
      displayed.total < 1
    ) {
      return null
    }
    return {
      page: Math.floor(displayed.page),
      total: Math.floor(displayed.total),
    }
  }

  const scheduleFullPaginationRemeasure = () => {
    // CSS-column page counts have no meaning in scroll mode — skip the whole
    // hidden-measurement pipeline instead of adapting it to a metric it was
    // never designed for.
    if (viewMode === 'scroll') return
    paginationTracker.invalidate()
    // `applySettings` can reach this synchronously from EpubRenderer's render
    // body (`syncEpubAppearance` is a plain function call in render, not an
    // effect) — publishing straight through would call the parent's
    // `onNavState` setState while EpubRenderer is still rendering. Deferring
    // one microtask moves it just past the current render without changing
    // when the caller perceives "locations ready" (still well before the
    // async hidden-measurement below can possibly resolve).
    queueMicrotask(publishLocationsReady)
    startHiddenPaginationMeasure()
  }

  const nextPage = async () => {
    cancelResizeAnchor()
    const beforeLocation = currentLocationSignature()
    const beforeSpine = currentSpineIndex()
    await activeRendition.next()
    await waitForFrames(2)
    if (currentLocationSignature() !== beforeLocation) return

    const resourcesReady = await waitForSectionResources(
      currentSectionDocument(activeRendition),
    )
    resizeToHost('reflow')
    await waitForFrames(2)
    await activeRendition.next()
    await waitForFrames(2)
    if (currentLocationSignature() !== beforeLocation) return

    // In scroll mode epub.js's own vertical-axis next() already resolves
    // `views.last().section.next()` once it reaches the section's real DOM
    // bottom (verified against epubjs's `managers/default` next()/prev()).
    // The `displayed.page >= displayed.total` self-heal below was tuned for
    // paginated CSS-column no-ops and is not meaningful here.
    if (viewMode === 'scroll') return

    const displayed = currentDisplayedBoundary()
    if (
      resourcesReady &&
      displayed &&
      displayed.page >= displayed.total &&
      currentSpineIndex() === beforeSpine &&
      beforeSpine < getSpineLength() - 1
    ) {
      await goToSpineIndex(beforeSpine + 1)
    }
  }
  const prevPage = async () => {
    cancelResizeAnchor()
    const beforeLocation = currentLocationSignature()
    const beforeSpine = currentSpineIndex()
    await activeRendition.prev()
    await waitForFrames(2)
    if (currentLocationSignature() !== beforeLocation) return

    const resourcesReady = await waitForSectionResources(
      currentSectionDocument(activeRendition),
    )
    resizeToHost('reflow')
    await waitForFrames(2)
    await activeRendition.prev()
    await waitForFrames(2)
    if (currentLocationSignature() !== beforeLocation) return

    if (viewMode === 'scroll') return

    const displayed = currentDisplayedBoundary()
    if (
      resourcesReady &&
      displayed &&
      displayed.page <= 1 &&
      currentSpineIndex() === beforeSpine &&
      beforeSpine > 0
    ) {
      await goToSpineIndex(beforeSpine - 1)
    }
  }

  const goToEnd = async (): Promise<boolean> => {
    const sections = spineLengthOf(book)
    if (sections <= 0) return false
    cancelResizeAnchor()
    const lastSpine = sections - 1
    if (currentSpineIndex() !== lastSpine) {
      await activeRendition.display(lastSpine)
      await waitForFrames(2)
    }
    await waitForSectionResources(currentSectionDocument(activeRendition))

    if (viewMode === 'scroll') {
      const container = (
        renditionManager(activeRendition) as { container?: HTMLElement } | undefined
      )?.container
      if (!container) return false
      // Reflow (images, fonts) can grow the section after the first jump — settle, then re-check.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        container.scrollTop = container.scrollHeight
        await waitForFrames(2)
        if (isAtVerticalScrollBoundary(activeRendition, 'down')) break
      }
      activeRendition.reportLocation()
      return currentSpineIndex() === lastSpine && isAtVerticalScrollBoundary(activeRendition, 'down')
    }

    const moveTo = activeRendition as unknown as {
      moveTo?: (offset: { top: number; left: number }) => void
    }
    // The page count of the last section can still change as it reflows, so measure again each
    // round and only report success once the displayed page is the section's last one.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const displayed = currentDisplayedBoundary()
      const delta = getRenditionLayoutDelta(activeRendition)
      if (displayed && delta > 0 && displayed.page < displayed.total) {
        moveTo.moveTo?.({ top: 0, left: (displayed.total - 1) * delta })
        await waitForFrames(2)
        activeRendition.reportLocation()
      }
      const after = currentDisplayedBoundary()
      if (after && after.page >= after.total) break
      await waitForFrames(2)
    }
    const final = currentDisplayedBoundary()
    return currentSpineIndex() === lastSpine && final !== null && final.page >= final.total
  }

  return {
    book,
    rendition: activeRendition,
    hasSpineCover,
    destroy: () => {
      paginationAbort?.abort()
      paginationAbort = null
      spineExcerptCache.dispose()
      try {
        activeRendition.off('selected', handleSelected)
        activeRendition.off('rendered', applyFocusedMarkClass)
        activeRendition.off('rendered', repositionStrikethroughLines)
        activeRendition.off('resized', repositionStrikethroughLines)
        activeRendition.off('rendered', applySearchHighlights)
        activeRendition.off('rendered', applyReadAloudHighlight)
        trackSelectionChangeDoc(null)
      } catch {
        /* ignore */
      }
      lastSelectionWindow = null
      selectionCb = null
      focusedMarkId = null
      strikethroughCfiRanges.clear()
      stopRenditionQueue(activeRendition)
      destroyBook()
    },
    next: nextPage,
    prev: prevPage,
    nextPage,
    prevPage,
    isAtScrollBoundary: (direction) =>
      isAtVerticalScrollBoundary(activeRendition, direction),
    nextSection: async () => {
      await goToSpineIndex(currentSpineIndex() + 1)
    },
    prevSection: async () => {
      await goToSpineIndex(currentSpineIndex() - 1)
    },
    goToHref,
    goToSpineIndex,
    goToEnd,
    goToLocationPage: (page: number) => {
      // Absolute page-number navigation is a paginated-only concept — there is
      // no CSS page count to resolve against once pagination measurement is
      // skipped in scroll mode (see `scheduleFullPaginationRemeasure`).
      if (viewMode === 'scroll') return Promise.resolve()
      return goToLocationPage(page)
    },
    getSpineLength,
    getCurrentLocation,
    getSpineExcerpt: spineExcerptCache.get,
    prefetchSpineExcerpts: spineExcerptCache.prefetchAround,
    getCurrentExcerpt,
    goToLocation,
    clearSelection: () => {
      try {
        lastSelectionWindow?.getSelection()?.removeAllRanges()
      } catch {
        /* ignore */
      }
      host.querySelectorAll('iframe').forEach((frame) => {
        try {
          frame.contentWindow?.getSelection()?.removeAllRanges()
        } catch {
          /* ignore */
        }
      })
    },
    getNavState: () => {
      const location = readRenditionLocation()
      const displayed = displayedPagesFromLocation(location)
      const cfi = cfiFromLocation(location)
      const currentSpine = currentSpineIndex()

      const metrics = paginationTracker.getNavMetrics(
        currentSpine,
        displayed.page,
        displayed.total,
      )
      return buildEpubNavState(
        book,
        currentSpine,
        getToc(),
        displayed,
        cfi,
        metrics,
      )
    },
    getToc,
    getSectionLabels,
    setTheme: (next) => {
      applyEpubThemeVars(activeRendition, next)
    },
    setLayout: (next) => {
      layout = next
      activeRendition.spread(spreadForLayout(next))
      applyDualSpreadHost(host, next)
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    setFontSize: (px) => {
      activeFontSize = px
      applyEpubFontSize(activeRendition, px)
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    setFontFamily: (fontFamily) => {
      activeReadingStyle = { ...activeReadingStyle, fontFamily }
      applyEpubReadingStyle(activeRendition, { fontFamily })
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    setFontWeight: (fontWeight) => {
      activeReadingStyle = { ...activeReadingStyle, fontWeight }
      applyEpubReadingStyle(activeRendition, { fontWeight })
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    setLineHeight: (lineHeight) => {
      activeReadingStyle = { ...activeReadingStyle, lineHeight }
      applyEpubReadingStyle(activeRendition, { lineHeight })
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    setTextAlign: (textAlign) => {
      activeReadingStyle = { ...activeReadingStyle, textAlign }
      applyEpubReadingStyle(activeRendition, { textAlign })
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    setMargins: (marginsEnabled, marginPreset) => {
      activeReadingStyle = { ...activeReadingStyle, marginsEnabled, marginPreset }
      applyEpubReadingStyle(activeRendition, { marginsEnabled, marginPreset })
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    setChromeHidden: (chromeHidden) => {
      activeReadingStyle = { ...activeReadingStyle, chromeHidden }
      applyEpubReadingStyle(activeRendition, { chromeHidden })
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    applySettings: (patch) => {
      if (destroyed || signal?.aborted) return false

      // Theme is a pure CSS-variable swap — it never changes text metrics, so
      // it must not drag a relayout in with it.
      let needsReflow = false
      const readingStylePatch: Partial<EpubReadingStyle> = {}

      try {
        if (patch.theme !== undefined) {
          applyEpubThemeVars(activeRendition, patch.theme)
        }

        if (patch.layout !== undefined && patch.layout !== layout) {
          layout = patch.layout
          activeRendition.spread(spreadForLayout(layout))
          applyDualSpreadHost(host, layout)
          needsReflow = true
        }

        if (patch.viewMode !== undefined && patch.viewMode !== viewMode) {
          // Isolated try/catch, separate from the outer one: a failed flow
          // switch must not discard style changes already applied above in
          // this same patch, and must not leave `viewMode` pointing at a
          // mode epub.js never actually adopted.
          const previousViewMode = viewMode
          try {
            activeRendition.flow(flowForViewMode(patch.viewMode))
            viewMode = patch.viewMode
            needsReflow = true
          } catch (err) {
            console.warn('[epub settings] view mode switch failed, keeping previous mode', err)
            viewMode = previousViewMode
          }
        }

        if (patch.fontSize !== undefined && patch.fontSize !== activeFontSize) {
          activeFontSize = patch.fontSize
          applyEpubFontSize(activeRendition, patch.fontSize)
          needsReflow = true
        }

        // Collect every reading-style field into one CSS write instead of one
        // write (plus reflow) per field.
        if (
          patch.fontFamily !== undefined &&
          patch.fontFamily !== activeReadingStyle.fontFamily
        ) {
          readingStylePatch.fontFamily = patch.fontFamily
        }
        if (
          patch.fontWeight !== undefined &&
          patch.fontWeight !== activeReadingStyle.fontWeight
        ) {
          readingStylePatch.fontWeight = patch.fontWeight
        }
        if (
          patch.lineHeight !== undefined &&
          patch.lineHeight !== activeReadingStyle.lineHeight
        ) {
          readingStylePatch.lineHeight = patch.lineHeight
        }
        if (
          patch.textAlign !== undefined &&
          patch.textAlign !== activeReadingStyle.textAlign
        ) {
          readingStylePatch.textAlign = patch.textAlign
        }
        if (
          patch.marginsEnabled !== undefined &&
          patch.marginsEnabled !== activeReadingStyle.marginsEnabled
        ) {
          readingStylePatch.marginsEnabled = patch.marginsEnabled
        }
        if (
          patch.marginPreset !== undefined &&
          patch.marginPreset !== activeReadingStyle.marginPreset
        ) {
          readingStylePatch.marginPreset = patch.marginPreset
        }
        if (
          patch.chromeHidden !== undefined &&
          patch.chromeHidden !== activeReadingStyle.chromeHidden
        ) {
          readingStylePatch.chromeHidden = patch.chromeHidden
        }

        if (Object.keys(readingStylePatch).length > 0) {
          activeReadingStyle = { ...activeReadingStyle, ...readingStylePatch }
          applyEpubReadingStyle(activeRendition, readingStylePatch)
          needsReflow = true
        }
      } catch (err) {
        // A torn-down iframe mid-apply must not take the reader down with it.
        console.warn('[epub settings] apply failed', err)
        return false
      }

      if (!needsReflow) return true

      try {
        resizeToHost()
        scheduleFullPaginationRemeasure()
      } catch (err) {
        // Styles already landed; only the reflow failed. Report success so the
        // caller does not replay the same styles, and let the next resize or
        // relocate settle pagination.
        console.warn('[epub settings] reflow after apply failed', err)
      }
      return true
    },
    resize: () => {
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    debugResolveCfiRect: (cfi) => {
      try {
        const EpubCFI = getEpubCFIConstructor()
        if (!EpubCFI) return null
        const doc = currentSectionDocument(activeRendition)
        if (!doc) return null
        const range = new EpubCFI(cfi.trim()).toRange(doc)
        if (!range) return null
        const rect = range.getBoundingClientRect()
        const iframe = host.querySelector('iframe')
        const iframeRect = iframe?.getBoundingClientRect()
        if (!iframeRect) return null
        return { rect, iframeRect }
      } catch {
        return null
      }
    },
    applyHighlight,
    removeHighlight,
    flashHighlight,
    getHighlightAtPoint,
    setFocusedHighlight,
    setSearchHighlights,
    goToSearchMatch,
    getReadAloudSegments,
    setReadAloudCursor,
    onTextSelected: (cb) => {
      selectionCb = cb
      return () => {
        if (selectionCb === cb) selectionCb = null
      }
    },
    getCurrentSelectionInfo,
  }
}
