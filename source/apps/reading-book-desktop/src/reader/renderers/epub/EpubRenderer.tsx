import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { CfiLocation, Highlight } from '@reading-book/domain'
import type {
  FontFamily,
  FontWeight,
  HighlightHandleRect,
  InteractionTool,
  ReaderTheme,
  TextAlign,
} from '@reading-book/shared/models'
import type {
  EpubReaderHighlight,
  PendingSelection,
} from '@reading-book/shared/models'
import type { DomCssOverlay } from '../../overlays/dom-css-overlay'
import {
  buildEpubSelectionPayloadFromDocument,
  epubFrameContextFromView,
  openEpubjs,
  type EpubFrameSelectionContext,
  type EpubjsHandle,
  type EpubNavState,
  type EpubPageLayout,
  type EpubPageMode,
  type EpubSelectionPayload,
  type EpubTocItem,
} from './openEpubjs'
import { applyInteractionToolSurface } from '../../cursors'
import {
  isPointInTextSelection,
  isTextNodeAtPoint,
  PAN_DRAG_THRESHOLD_PX,
} from '../../interaction-hit'
/** Imperative nav for parent footer scrub / section jump. */
export type EpubRendererApi = Pick<
  EpubjsHandle,
  | 'nextPage'
  | 'prevPage'
  | 'nextSection'
  | 'prevSection'
  | 'goToHref'
  | 'goToSpineIndex'
  | 'getSpineLength'
  | 'getNavState'
  | 'getToc'
  | 'getCurrentLocation'
  | 'goToLocation'
  | 'clearSelection'
  | 'setFontSize'
  | 'setFontFamily'
  | 'setFontWeight'
  | 'setLineHeight'
  | 'setTextAlign'
  | 'setMargins'
  | 'setChromeHidden'
> & {
  /** Force DomCssOverlay full reload (T5.3) — usually driven by `rendered` / props. */
  repaintHighlights: () => void
}

type EpubRendererProps = {
  data: ArrayBuffer
  /** Extracted cover shown as page 1 when the EPUB has no cover document in its spine. */
  coverUrl?: string
  theme: ReaderTheme
  layout?: EpubPageLayout
  pageMode?: EpubPageMode
  /** Reflow zoom — px (same scale as Aa font size). */
  fontSize?: number
  fontFamily?: FontFamily
  fontWeight?: FontWeight
  lineHeight?: number
  textAlign?: TextAlign
  marginsEnabled?: boolean
  marginPreset?: string
  /** Reader chrome hidden → wider text column. */
  chromeHidden?: boolean
  /** Resume at CFI on open (T4.1). Wired by T4.4. */
  initialLocation?: CfiLocation
  className?: string
  /** Tap/click the center reading zone to reveal/hide Reader chrome. */
  onCenterTap?: () => void
  onNavState?: (state: EpubNavState) => void
  /** Stable CFI after relocated — for persist flush (T4.2). */
  onLocationChange?: (location: CfiLocation) => void
  onToc?: (items: EpubTocItem[]) => void
  /** Right-click on selected text → selection menu (FR-06). */
  onSelectionContextMenu?: (
    selection: PendingSelection,
    anchor: { x: number; y: number },
  ) => void
  /**
   * Fired when Highlight tool finishes a selection (pointerup).
   * Text Select does not auto-open the toolbar — right-click does.
   */
  onTextSelected?: (selection: PendingSelection) => void
  /** Dismiss menu when page/section changes. */
  onSelectionDismiss?: () => void
  /** Click an existing painted highlight (tool color-edit panel). */
  onHighlightMarkClick?: (mark: {
    id: string
    cfiRange: string
    colorHex: string
    rect: HighlightHandleRect
    click: { x: number; y: number }
  }) => void
  /** In-memory EPUB highlights to paint via epubjs annotations (T5.1). */
  highlights?: EpubReaderHighlight[]
  /** Active Hand / Text Select mode for cursor + pointer behavior. */
  interactionTool?: InteractionTool
  /**
   * Smart Hand ↔ Text Select:
   * - Hand + text press → Select (same gesture can select)
   * - Auto Select + margin pan/click → Hand (unless toolbar-locked)
   */
  onRequestInteractionTool?: (tool: InteractionTool) => void
  /**
   * Hand + Ctrl/Meta wheel — focus-zoom. Coords are viewport (parent) space.
   * Return true if the event was handled.
   */
  onFocusZoomWheel?: (detail: {
    clientX: number
    clientY: number
    deltaY: number
  }) => boolean
  /** Hand pan deltas (px) — used to scroll the outer zoom viewport when zoomed. */
  onHandPanBy?: (dx: number, dy: number) => void
  apiRef?: MutableRefObject<EpubRendererApi | null>
}

function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name?: string }).name === 'AbortError'
  )
}


function hasFrameTextSelection(doc: Document): boolean {
  const sel = doc.defaultView?.getSelection()
  return !!sel && !sel.isCollapsed && (sel.toString()?.trim().length ?? 0) > 0
}

function isInteractiveElement(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return !!el.closest(
    'a, button, input, textarea, select, summary, [role="button"], [contenteditable="true"]',
  )
}

function isCenterClick(event: MouseEvent, doc: Document): boolean {
  const width =
    doc.defaultView?.innerWidth ||
    doc.documentElement.clientWidth ||
    doc.body?.clientWidth ||
    0
  if (width <= 0) return false
  return event.clientX >= width * 0.25 && event.clientX <= width * 0.75
}

type SyntheticCoverNavigation = {
  isAvailable: () => boolean
  isShown: () => boolean
  show: () => Promise<void>
  hide: () => void
  navState: () => EpubNavState
}

function toApi(
  handle: EpubjsHandle,
  cover: SyntheticCoverNavigation,
  repaintHighlights: () => void,
): EpubRendererApi {
  return {
    nextPage: async () => {
      if (cover.isShown()) {
        cover.hide()
        return
      }
      await handle.nextPage()
    },
    prevPage: async () => {
      if (cover.isShown()) return
      if (!cover.isAvailable()) {
        await handle.prevPage()
        return
      }
      const before = handle.getCurrentLocation()?.cfi
      await handle.prevPage()
      const after = handle.getCurrentLocation()?.cfi
      if (
        handle.getNavState().spineIndex === 0 &&
        before === after
      ) {
        await cover.show()
      }
    },
    nextSection: async () => {
      if (cover.isShown()) {
        cover.hide()
        return
      }
      await handle.nextSection()
    },
    prevSection: async () => {
      if (cover.isShown()) return
      if (cover.isAvailable() && handle.getNavState().spineIndex === 0) {
        await cover.show()
        return
      }
      await handle.prevSection()
    },
    goToHref: async (href) => {
      cover.hide()
      await handle.goToHref(href)
    },
    goToSpineIndex: async (i) => {
      if (cover.isAvailable()) {
        if (i <= 0) {
          await cover.show()
          return
        }
        cover.hide()
        await handle.goToSpineIndex(i - 1)
        return
      }
      await handle.goToSpineIndex(i)
    },
    getSpineLength: () =>
      handle.getSpineLength() + (cover.isAvailable() ? 1 : 0),
    getNavState: cover.navState,
    getToc: () => handle.getToc(),
    getCurrentLocation: () => handle.getCurrentLocation(),
    goToLocation: async (location) => {
      cover.hide()
      await handle.goToLocation(location)
    },
    setFontSize: (px) => handle.setFontSize(px),
    setFontFamily: (family) => handle.setFontFamily(family),
    setFontWeight: (weight) => handle.setFontWeight(weight),
    setLineHeight: (lineHeight) => handle.setLineHeight(lineHeight),
    setTextAlign: (textAlign) => handle.setTextAlign(textAlign),
    setMargins: (enabled, preset) => handle.setMargins(enabled, preset),
    setChromeHidden: (hidden) => handle.setChromeHidden(hidden),
    clearSelection: () => handle.clearSelection(),
    repaintHighlights,
  }
}

/** Convert in-memory EPUB highlights → domain Highlight for DomCssOverlay.paint. */
function epubHighlightsToDomain(
  highlights: EpubReaderHighlight[],
): Highlight[] {
  const now = new Date().toISOString()
  const out: Highlight[] = []
  for (const h of highlights) {
    const cfiRange = (h.cfiRange || h.locationStart || '').trim()
    if (!cfiRange) continue
    const selectedText = h.selectedText.trim() || ' '
    try {
      out.push(
        new Highlight({
          id: h.id,
          bookId: '_',
          location: Highlight.packLocation(
            new CfiLocation(cfiRange),
            new CfiLocation(
              (h.locationEnd || h.locationStart || cfiRange).trim() || cfiRange,
            ),
          ),
          selectedText,
          colorHex: h.colorHex,
          note: h.note,
          createdAt: h.createdAt || now,
          updatedAt: h.updatedAt || now,
        }),
      )
    } catch {
      /* skip invalid color / location */
    }
  }
  return out
}

function selectionPayloadToPending(
  payload: EpubSelectionPayload,
): PendingSelection {
  return {
    source: 'epub',
    cfiRange: payload.cfiRange,
    locationStart: payload.locationStart,
    locationEnd: payload.locationEnd,
    selectedText: payload.selectedText,
    rect: payload.rect,
    chapterIndex: payload.sectionIndex,
  }
}

/**
 * Production EPUB surface (T3.3) — epubjs from ArrayBuffer; no FS paths.
 * Dual layout draws a center gutter; spine order includes cover as a normal page.
 * T3.5: page/section nav + relocated state for footer scrub.
 */
export function EpubRenderer({
  data,
  coverUrl,
  theme,
  layout = 'single',
  pageMode = 'paginated',
  fontSize = 18,
  fontFamily = 'serif',
  fontWeight = 400,
  lineHeight = 1.65,
  textAlign = 'justify',
  marginsEnabled = true,
  marginPreset = 'normal',
  chromeHidden = true,
  initialLocation,
  className,
  onCenterTap,
  onNavState,
  onLocationChange,
  onToc,
  onSelectionContextMenu,
  onTextSelected,
  onSelectionDismiss,
  onHighlightMarkClick,
  highlights,
  interactionTool = 'hand',
  onRequestInteractionTool,
  onFocusZoomWheel,
  onHandPanBy,
  apiRef,
}: EpubRendererProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<EpubjsHandle | null>(null)
  const overlayPainterRef = useRef<DomCssOverlay | null>(null)
  const highlightsRef = useRef<EpubReaderHighlight[]>(highlights ?? [])
  highlightsRef.current = highlights ?? []
  const lastEpubSelectionRef = useRef<PendingSelection | null>(null)
  const interactionToolRef = useRef<InteractionTool>(interactionTool)
  interactionToolRef.current = interactionTool
  const onRequestInteractionToolRef = useRef(onRequestInteractionTool)
  onRequestInteractionToolRef.current = onRequestInteractionTool
  const onFocusZoomWheelRef = useRef(onFocusZoomWheel)
  onFocusZoomWheelRef.current = onFocusZoomWheel
  const onHandPanByRef = useRef(onHandPanBy)
  onHandPanByRef.current = onHandPanBy
  const grabbingRef = useRef(false)
  const onNavStateRef = useRef(onNavState)
  onNavStateRef.current = onNavState
  const onLocationChangeRef = useRef(onLocationChange)
  onLocationChangeRef.current = onLocationChange
  const onTocRef = useRef(onToc)
  onTocRef.current = onToc
  const onCenterTapRef = useRef(onCenterTap)
  onCenterTapRef.current = onCenterTap
  const onSelectionContextMenuRef = useRef(onSelectionContextMenu)
  onSelectionContextMenuRef.current = onSelectionContextMenu
  const onTextSelectedRef = useRef(onTextSelected)
  onTextSelectedRef.current = onTextSelected
  const onSelectionDismissRef = useRef(onSelectionDismiss)
  onSelectionDismissRef.current = onSelectionDismiss
  const onHighlightMarkClickRef = useRef(onHighlightMarkClick)
  onHighlightMarkClickRef.current = onHighlightMarkClick
  const coverUrlRef = useRef(coverUrl)
  coverUrlRef.current = coverUrl
  const initialLocationRef = useRef(initialLocation)
  initialLocationRef.current = initialLocation
  const apiRefProp = useRef(apiRef)
  apiRefProp.current = apiRef

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [syntheticCoverShown, setSyntheticCoverShown] = useState(false)
  const syntheticCoverShownRef = useRef(false)

  const paintHighlightsNow = useCallback(() => {
    const painter = overlayPainterRef.current
    if (!painter) return
    const domain = epubHighlightsToDomain(highlightsRef.current)
    void painter.paint({ highlights: domain })
  }, [])

  const repaintTimerRef = useRef<number | null>(null)
  const scheduleRepaint = useCallback(() => {
    // Debounce: epubjs may fire multiple `rendered` events during a single turn.
    if (!overlayPainterRef.current) return
    if (repaintTimerRef.current != null) {
      window.clearTimeout(repaintTimerRef.current)
    }
    repaintTimerRef.current = window.setTimeout(() => {
      repaintTimerRef.current = null
      paintHighlightsNow()
    }, 50)
  }, [paintHighlightsNow])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const ac = new AbortController()
    setStatus('loading')
    setErrorMessage(null)
    syntheticCoverShownRef.current = false
    setSyntheticCoverShown(false)
    overlayPainterRef.current = null
    if (apiRefProp.current) apiRefProp.current.current = null

    openEpubjs(data, host, {
      theme,
      layout,
      pageMode,
      fontSize,
      fontFamily,
      fontWeight,
      lineHeight,
      textAlign,
      marginsEnabled,
      marginPreset,
      chromeHidden,
      initialLocation: initialLocationRef.current,
      signal: ac.signal,
      onSelected: (payload) => {
        // Cache only — floating toolbar opens on right-click, not mouseup.
        // Highlight tool applies on pointerup (see attachFrameListeners).
        lastEpubSelectionRef.current = selectionPayloadToPending(payload)
      },
    })
      .then((handle) => {
        if (ac.signal.aborted) {
          handle.destroy()
          return
        }
        handleRef.current = handle
        overlayPainterRef.current = handle.overlayPainter
        handle.overlayPainter.setOnMarkClick((mark) => {
          onHighlightMarkClickRef.current?.(mark)
        })

        const hasSyntheticCover = () =>
          Boolean(coverUrlRef.current) && !handle.hasSpineCover()
        const getAdjustedNavState = (): EpubNavState => {
          const nav = handle.getNavState()
          if (!hasSyntheticCover()) return nav
          const spineLength = nav.spineLength + 1
          const spineIndex = syntheticCoverShownRef.current
            ? 0
            : nav.spineIndex + 1
          return {
            ...nav,
            spineIndex,
            spineLength,
            pageCurrent: spineIndex + 1,
            pageTotal: spineLength,
            href: syntheticCoverShownRef.current ? '' : nav.href,
            label: syntheticCoverShownRef.current ? 'Cover' : nav.label,
            progress:
              spineLength <= 1 ? 0 : spineIndex / (spineLength - 1),
          }
        }
        const hideSyntheticCover = () => {
          if (!syntheticCoverShownRef.current) return
          syntheticCoverShownRef.current = false
          setSyntheticCoverShown(false)
          onNavStateRef.current?.(getAdjustedNavState())
        }
        const showSyntheticCover = async () => {
          if (!hasSyntheticCover()) return
          await handle.goToSpineIndex(0)
          syntheticCoverShownRef.current = true
          setSyntheticCoverShown(true)
          onNavStateRef.current?.(getAdjustedNavState())
        }
        const coverNavigation: SyntheticCoverNavigation = {
          isAvailable: hasSyntheticCover,
          isShown: () => syntheticCoverShownRef.current,
          show: showSyntheticCover,
          hide: hideSyntheticCover,
          navState: getAdjustedNavState,
        }
        if (apiRefProp.current) {
          apiRefProp.current.current = toApi(
            handle,
            coverNavigation,
            paintHighlightsNow,
          )
        }

        const onRelocated = () => {
          onSelectionDismissRef.current?.()
          onNavStateRef.current?.(getAdjustedNavState())
          const location = handle.getCurrentLocation()
          if (location) onLocationChangeRef.current?.(location)
        }
        const frameCleanups = new Map<Document, () => void>()
        const frameContextByDoc = new WeakMap<Document, EpubFrameSelectionContext>()
        const attachFrameListeners = (doc: Document | null | undefined) => {
          if (!doc || frameCleanups.has(doc)) return

          type PointerGesture = {
            startX: number
            startY: number
            lastX: number
            lastY: number
            hitText: boolean
            panned: boolean
            scrollEl: Element | null
          }
          let gesture: PointerGesture | null = null

          const scrollRoot = (): Element | null => {
            const scrolling = doc.scrollingElement
            if (scrolling && scrolling.scrollHeight > scrolling.clientHeight + 1) {
              return scrolling
            }
            if (doc.documentElement.scrollHeight > doc.documentElement.clientHeight + 1) {
              return doc.documentElement
            }
            if (doc.body && doc.body.scrollHeight > doc.body.clientHeight + 1) {
              return doc.body
            }
            return doc.scrollingElement ?? doc.documentElement
          }

          const applySurface = (grabbing = false) => {
            grabbingRef.current = grabbing
            applyInteractionToolSurface(
              hostRef.current,
              interactionToolRef.current,
              { grabbing },
            )
          }

          // Keyboard page/section nav lives on ReaderScreen (window + iframe capture).
          const onContextMenu = (event: MouseEvent) => {
            // Always suppress the native menu inside the reading surface.
            event.preventDefault()
            event.stopPropagation()

            // Floating toolbar only when right-clicking the active selection.
            if (
              interactionToolRef.current === 'highlight' ||
              !hasFrameTextSelection(doc) ||
              !isPointInTextSelection(doc, event.clientX, event.clientY)
            ) {
              return
            }

            const frameEl = doc.defaultView?.frameElement as HTMLElement | null
            const ctx = frameContextByDoc.get(doc)
            const livePayload = ctx
              ? buildEpubSelectionPayloadFromDocument(doc, frameEl, ctx)
              : null
            const pending = livePayload
              ? selectionPayloadToPending(livePayload)
              : lastEpubSelectionRef.current
            if (!pending) return

            lastEpubSelectionRef.current = pending

            let x = event.clientX
            let y = event.clientY
            if (frameEl) {
              const fr = frameEl.getBoundingClientRect()
              x += fr.left
              y += fr.top
            }
            // Do not clear the native selection — menu stays contextual to it.
            onSelectionContextMenuRef.current?.(pending, { x, y })
          }

          const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0 || isInteractiveElement(event.target)) return
            const tool = interactionToolRef.current
            const hitText = isTextNodeAtPoint(doc, event.clientX, event.clientY)

            if (tool === 'hand') {
              if (hitText) {
                // Smart switch: arm Text Select so this gesture can select immediately.
                interactionToolRef.current = 'select'
                onRequestInteractionToolRef.current?.('select')
                applySurface(false)
                gesture = null
                return
              }
              // Block native text selection while panning.
              event.preventDefault()
              gesture = {
                startX: event.clientX,
                startY: event.clientY,
                lastX: event.clientX,
                lastY: event.clientY,
                hitText: false,
                panned: false,
                scrollEl: scrollRoot(),
              }
              applySurface(true)
              return
            }

            // Highlight stays latched until the user picks another tool.
            if (tool === 'highlight') {
              gesture = null
              return
            }

            // Text Select: blank margin → pan (and auto-revert when unlocked).
            if (!hitText) {
              gesture = {
                startX: event.clientX,
                startY: event.clientY,
                lastX: event.clientX,
                lastY: event.clientY,
                hitText: false,
                panned: false,
                scrollEl: scrollRoot(),
              }
            } else {
              gesture = null
            }
          }

          const onPointerMove = (event: PointerEvent) => {
            if (!gesture || (event.buttons & 1) === 0) return
            const dx = event.clientX - gesture.lastX
            const dy = event.clientY - gesture.lastY
            const totalDx = event.clientX - gesture.startX
            const totalDy = event.clientY - gesture.startY
            gesture.lastX = event.clientX
            gesture.lastY = event.clientY

            if (
              !gesture.panned &&
              Math.hypot(totalDx, totalDy) >= PAN_DRAG_THRESHOLD_PX
            ) {
              gesture.panned = true
            }

            const tool = interactionToolRef.current
            if (tool === 'hand' || (tool === 'select' && !gesture.hitText)) {
              // Prefer outer zoom-viewport pan when the parent is scrolled/zoomed.
              if (onHandPanByRef.current) {
                onHandPanByRef.current(dx, dy)
              } else {
                const el = gesture.scrollEl
                if (el) {
                  el.scrollLeft -= dx
                  el.scrollTop -= dy
                }
              }
              if (gesture.panned) {
                onRequestInteractionToolRef.current?.('hand')
                applySurface(true)
              }
            }
          }

          const endGesture = (event: PointerEvent) => {
            if (!gesture) return
            const g = gesture
            gesture = null
            applySurface(false)

            const tool = interactionToolRef.current
            if (tool === 'highlight') return

            if (g.panned) {
              // Margin / whitespace drag → Hand (ignored when Text Select is toolbar-locked).
              onRequestInteractionToolRef.current?.('hand')
              return
            }

            if (tool === 'hand') {
              // Margin tap: chrome toggle (text clicks already switched on pointerdown).
              onRequestInteractionToolRef.current?.('hand')
              if (!isInteractiveElement(event.target) && isCenterClick(event, doc)) {
                onSelectionDismissRef.current?.()
                onCenterTapRef.current?.()
              }
              return
            }

            // Auto-switched select: click outside text without a selection → Hand.
            if (!g.hitText) {
              onRequestInteractionToolRef.current?.('hand')
              if (!hasFrameTextSelection(doc)) {
                onSelectionDismissRef.current?.()
              }
              if (!isInteractiveElement(event.target) && isCenterClick(event, doc)) {
                onCenterTapRef.current?.()
              }
            }
          }

          const applyHighlightSelectionOnRelease = () => {
            if (interactionToolRef.current !== 'highlight') return

            const ctx = frameContextByDoc.get(doc)
            if (!ctx) return

            const frameEl = doc.defaultView?.frameElement as HTMLElement | null
            const payload = buildEpubSelectionPayloadFromDocument(
              doc,
              frameEl,
              ctx,
            )
            if (!payload) return

            const pending = selectionPayloadToPending(payload)
            lastEpubSelectionRef.current = pending
            onTextSelectedRef.current?.(pending)
          }

          const onPointerUp = (event: PointerEvent) => {
            if (event.button !== 0) return
            endGesture(event)
            applyHighlightSelectionOnRelease()
          }

          const onPointerCancel = (event: PointerEvent) => {
            endGesture(event)
          }

          const onClick = (event: MouseEvent) => {
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              isInteractiveElement(event.target)
            ) {
              return
            }

            // Hand-mode chrome taps are handled in pointerup.
            if (interactionToolRef.current === 'hand') return

            const hasSelection = hasFrameTextSelection(doc)
            if (!hasSelection) {
              onSelectionDismissRef.current?.()
              // Auto-switched select + empty click (cancel / no range) → Hand.
              // Locked toolbar select stays put (requestInteractionTool gates it).
              if (
                interactionToolRef.current === 'select' &&
                !isTextNodeAtPoint(doc, event.clientX, event.clientY)
              ) {
                onRequestInteractionToolRef.current?.('hand')
              }
            }
            if (hasSelection) return

            // Clicks on text stay in select; margin handled in pointerup.
            if (isTextNodeAtPoint(doc, event.clientX, event.clientY)) return
            if (!isCenterClick(event, doc)) return
            onCenterTapRef.current?.()
          }

          const onWheel = (event: WheelEvent) => {
            if (!(event.ctrlKey || event.metaKey)) return
            if (interactionToolRef.current !== 'hand') return
            const frameEl = doc.defaultView?.frameElement as HTMLElement | null
            let clientX = event.clientX
            let clientY = event.clientY
            if (frameEl) {
              const fr = frameEl.getBoundingClientRect()
              clientX += fr.left
              clientY += fr.top
            }
            const handled = onFocusZoomWheelRef.current?.({
              clientX,
              clientY,
              deltaY: event.deltaY,
            })
            if (handled) {
              event.preventDefault()
              event.stopPropagation()
            }
          }

          doc.addEventListener('contextmenu', onContextMenu)
          doc.addEventListener('pointerdown', onPointerDown, { capture: true })
          doc.addEventListener('pointermove', onPointerMove, { capture: true })
          doc.addEventListener('pointerup', onPointerUp, { capture: true })
          doc.addEventListener('pointercancel', onPointerCancel, { capture: true })
          doc.addEventListener('click', onClick)
          doc.addEventListener('wheel', onWheel, { capture: true, passive: false })
          frameCleanups.set(doc, () => {
            doc.removeEventListener('contextmenu', onContextMenu)
            doc.removeEventListener('pointerdown', onPointerDown, true)
            doc.removeEventListener('pointermove', onPointerMove, true)
            doc.removeEventListener('pointerup', onPointerUp, true)
            doc.removeEventListener('pointercancel', onPointerCancel, true)
            doc.removeEventListener('click', onClick)
            doc.removeEventListener('wheel', onWheel, true)
          })
        }
        const attachOnRendered = (_section: unknown, view: unknown) => {
          const frame = epubFrameContextFromView(view)
          if (frame) {
            frameContextByDoc.set(frame.doc, frame.ctx)
            attachFrameListeners(frame.doc)
          }
          // T5.3 — section iframe may be fresh; reload DomCssOverlay marks.
          scheduleRepaint()
        }
        const cleanupFrameListeners = () => {
          handle.rendition.off('rendered', attachOnRendered)
          frameCleanups.forEach((cleanup) => cleanup())
          frameCleanups.clear()
        }

        handle.rendition.on('relocated', onRelocated)
        handle.rendition.on('rendered', attachOnRendered)
        host
          .querySelectorAll('iframe')
          .forEach((frame) => attachFrameListeners(frame.contentDocument))
        if (!initialLocationRef.current && hasSyntheticCover()) {
          syntheticCoverShownRef.current = true
          setSyntheticCoverShown(true)
        }
        onNavStateRef.current?.(getAdjustedNavState())
        const initialCfi = handle.getCurrentLocation()
        if (initialCfi) onLocationChangeRef.current?.(initialCfi)
        onTocRef.current?.(handle.getToc())
        // Initial paint once rendition is ready (hydrate + live highlights).
        paintHighlightsNow()
        setStatus('ready')

        ac.signal.addEventListener(
          'abort',
          () => {
            handle.rendition.off('relocated', onRelocated)
            cleanupFrameListeners()
          },
          { once: true },
        )
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || isAbortError(err)) return
        handleRef.current = null
        overlayPainterRef.current = null
        if (apiRefProp.current) apiRefProp.current.current = null
        setStatus('error')
        setErrorMessage(
          err instanceof Error ? err.message : 'Could not open this EPUB.',
        )
      })

    return () => {
      if (repaintTimerRef.current != null) {
        window.clearTimeout(repaintTimerRef.current)
        repaintTimerRef.current = null
      }
      const currentLocation = handleRef.current?.getCurrentLocation()
      if (currentLocation) initialLocationRef.current = currentLocation
      ac.abort()
      handleRef.current?.destroy()
      handleRef.current = null
      overlayPainterRef.current = null
      syntheticCoverShownRef.current = false
      if (apiRefProp.current) apiRefProp.current.current = null
    }
    // Re-open when bytes / pagination mode change; layout toggles via setLayout.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theme/layout applied below
  }, [data, pageMode, paintHighlightsNow, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setTheme(theme)
    scheduleRepaint()
  }, [theme, scheduleRepaint])

  // T5.3 — DomCssOverlay full reload when highlight list changes.
  useEffect(() => {
    if (status !== 'ready') return
    paintHighlightsNow()
  }, [highlights, status, paintHighlightsNow])

  useEffect(() => {
    handleRef.current?.setLayout(layout)
    scheduleRepaint()
  }, [layout, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setFontSize(fontSize)
    scheduleRepaint()
  }, [fontSize, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setFontFamily(fontFamily)
    scheduleRepaint()
  }, [fontFamily, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setFontWeight(fontWeight)
    scheduleRepaint()
  }, [fontWeight, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setLineHeight(lineHeight)
    scheduleRepaint()
  }, [lineHeight, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setTextAlign(textAlign)
    scheduleRepaint()
  }, [textAlign, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setMargins(marginsEnabled, marginPreset)
    scheduleRepaint()
  }, [marginPreset, marginsEnabled, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setChromeHidden(chromeHidden)
    scheduleRepaint()
  }, [chromeHidden, scheduleRepaint])

  useEffect(() => {
    const host = hostRef.current
    if (!host || status !== 'ready') return

    const apply = () =>
      applyInteractionToolSurface(host, interactionTool, {
        grabbing: grabbingRef.current && interactionTool === 'hand',
      })
    apply()

    const mo = new MutationObserver(apply)
    mo.observe(host, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      applyInteractionToolSurface(host, 'hand', { grabbing: false })
    }
  }, [interactionTool, status])

  useEffect(() => {
    const handle = handleRef.current
    if (status !== 'ready' || !handle) return
    const available = Boolean(coverUrl) && !handle.hasSpineCover()
    if (!available && syntheticCoverShownRef.current) {
      syntheticCoverShownRef.current = false
      setSyntheticCoverShown(false)
      onNavStateRef.current?.(handle.getNavState())
      return
    }
    if (
      available &&
      !initialLocationRef.current &&
      handle.getNavState().spineIndex === 0
    ) {
      syntheticCoverShownRef.current = true
      setSyntheticCoverShown(true)
      const nav = handle.getNavState()
      const spineLength = nav.spineLength + 1
      onNavStateRef.current?.({
        ...nav,
        spineIndex: 0,
        spineLength,
        pageCurrent: 1,
        pageTotal: spineLength,
        href: '',
        label: 'Cover',
        progress: 0,
      })
    }
  }, [coverUrl, status])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ro = new ResizeObserver(() => {
      handleRef.current?.resize()
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [status])

  const showGutter = layout !== 'single' && status === 'ready'

  // ── Custom scrollbar for scroll mode ──────────────────────────────────────
  const [scrollThumb, setScrollThumb] = useState({ top: 0, height: 0 })
  const [scrollVisible, setScrollVisible] = useState(false)
  const scrollHideTimerRef = useRef<number | null>(null)
  const scrollIframeRef = useRef<HTMLIFrameElement | null>(null)

  const readScrollMetrics = useCallback(() => {
    const iframe = scrollIframeRef.current
    const doc = iframe?.contentDocument
    const body = doc?.body || doc?.documentElement
    if (!body) return null
    const scrollTop = body.scrollTop || doc?.documentElement?.scrollTop || 0
    const scrollHeight = body.scrollHeight || doc?.documentElement?.scrollHeight || 0
    const clientHeight = body.clientHeight || doc?.documentElement?.clientHeight || 0
    if (scrollHeight <= clientHeight) return null
    return { scrollTop, scrollHeight, clientHeight }
  }, [])

  const updateScrollThumb = useCallback(() => {
    if (pageMode !== 'scroll') return
    const m = readScrollMetrics()
    if (!m) {
      setScrollThumb({ top: 0, height: 0 })
      return
    }
    const trackH = 100
    const thumbH = Math.max((m.clientHeight / m.scrollHeight) * trackH, 8)
    const maxTop = trackH - thumbH
    const thumbTop = (m.scrollTop / (m.scrollHeight - m.clientHeight)) * maxTop
    setScrollThumb({ top: thumbTop, height: thumbH })

    setScrollVisible(true)
    if (scrollHideTimerRef.current != null) window.clearTimeout(scrollHideTimerRef.current)
    scrollHideTimerRef.current = window.setTimeout(() => {
      setScrollVisible(false)
      scrollHideTimerRef.current = null
    }, 1200)
  }, [pageMode, readScrollMetrics])

  // Attach scroll listener to EPUB iframe doc whenever it changes (page turn / new section)
  useEffect(() => {
    if (pageMode !== 'scroll' || status !== 'ready') return
    const host = hostRef.current
    if (!host) return

    let cleanup: (() => void) | null = null

    const attachToIframe = () => {
      const iframe = host.querySelector('iframe') as HTMLIFrameElement | null
      if (!iframe || iframe === scrollIframeRef.current) return
      scrollIframeRef.current = iframe

      if (cleanup) cleanup()

      const doc = iframe.contentDocument
      const scrollTarget = doc?.body || doc?.documentElement
      if (!scrollTarget) return

      const onScroll = () => updateScrollThumb()
      scrollTarget.addEventListener('scroll', onScroll, { passive: true })
      // Also listen on the iframe window level
      iframe.contentWindow?.addEventListener('scroll', onScroll, { passive: true })
      updateScrollThumb()

      cleanup = () => {
        scrollTarget.removeEventListener('scroll', onScroll)
        iframe.contentWindow?.removeEventListener('scroll', onScroll)
      }
    }

    const mo = new MutationObserver(attachToIframe)
    mo.observe(host, { childList: true, subtree: true })
    attachToIframe()
    const poll = window.setInterval(attachToIframe, 600)

    return () => {
      mo.disconnect()
      window.clearInterval(poll)
      cleanup?.()
      scrollIframeRef.current = null
      if (scrollHideTimerRef.current != null) {
        window.clearTimeout(scrollHideTimerRef.current)
        scrollHideTimerRef.current = null
      }
    }
  }, [pageMode, status, updateScrollThumb])

  const showCustomScrollbar = pageMode === 'scroll' && status === 'ready' && scrollThumb.height > 0

  return (
    <main
      className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${className ?? ''}`}
      data-epub-status={status}
      data-epub-layout={layout}
      data-epub-page-mode={pageMode}
    >
      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
          <div
            className="size-9 shrink-0 animate-spin rounded-full border-[3px] border-current/20 border-t-current opacity-80"
            aria-hidden
          />
          <span className="text-sm opacity-70">Opening book…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-sm text-rose-300">
          {errorMessage ?? 'Could not open this EPUB.'}
        </div>
      )}
      {/* Multi-page spread gutters — visible gray bands between page columns. */}
      {showGutter ? (
        <>
          <div
            className={`pointer-events-none absolute inset-y-0 z-[7] flex w-3 -translate-x-1/2 flex-col items-center justify-stretch ${
              layout === 'triple' ? 'left-1/3' : 'left-1/2'
            }`}
            aria-hidden
          >
            <div className="h-full w-full bg-neutral-500/20" />
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-neutral-400/75" />
          </div>
          {layout === 'triple' ? (
            <div
              className="pointer-events-none absolute inset-y-0 left-2/3 z-[7] flex w-3 -translate-x-1/2 flex-col items-center justify-stretch"
              aria-hidden
            >
              <div className="h-full w-full bg-neutral-500/20" />
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-neutral-400/75" />
            </div>
          ) : null}
        </>
      ) : null}
      {syntheticCoverShown && coverUrl ? (
        <div
          className="absolute inset-0 z-[8] flex items-center justify-center bg-lib-bg-deep p-6"
          data-epub-synthetic-cover
        >
          <img
            src={coverUrl}
            alt="Book cover"
            className="max-h-full max-w-full object-contain shadow-2xl"
            draggable={false}
          />
        </div>
      ) : null}
      <div
        ref={hostRef}
        className={`h-full w-full min-h-0 flex-1 [&_iframe]:h-full [&_iframe]:w-full ${
          interactionTool === 'highlight'
            ? 'cursor-highlight-tool'
            : interactionTool === 'select'
              ? 'cursor-select-tool'
              : 'cursor-hand-tool'
        } ${
          showGutter
            ? 'bg-neutral-600/15 [&_.epub-container]:bg-transparent [&_.epub-view]:shadow-[0_0_0_1px_rgba(148,163,184,0.35)]'
            : ''
        }`}
        tabIndex={-1}
      />
      {/* Custom thin scrollbar overlay — only in scroll mode */}
      {showCustomScrollbar ? (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-[9] w-[7px] py-1"
          aria-hidden
        >
          {/* Track */}
          <div className="relative h-full w-full overflow-hidden rounded-full">
            <div
              className="absolute inset-0 rounded-full bg-white/5 transition-opacity duration-300"
              style={{ opacity: scrollVisible ? 1 : 0 }}
            />
            {/* Thumb */}
            <div
              className="absolute left-[1px] right-[1px] rounded-full transition-[top,height,opacity] duration-150"
              style={{
                top: `${scrollThumb.top}%`,
                height: `${scrollThumb.height}%`,
                background: 'rgb(148 163 184 / 0.55)',
                opacity: scrollVisible ? 1 : 0,
                transition: scrollVisible
                  ? 'top 0.1s ease, height 0.1s ease, opacity 0.15s ease'
                  : 'opacity 0.6s ease 0.6s',
              }}
            />
          </div>
        </div>
      ) : null}
    </main>
  )
}
