/**
 * DomCssOverlay — EPUB reflow highlight painter (T5.3 / SDS OverlayPainter).
 *
 * Primary paint: resolve CFI → DOM Range → per-line rect overlays.
 * Works for poetry / <br> / span / div — not only simple <p> blocks.
 * The tolerant resolver in `cfi-dom-range` runs before epubjs `contents.range`
 * so unresolvable text steps do not spam `No startContainer found`. Then a
 * re-anchor by the mark's captured text. Whichever candidate reproduces that
 * text wins.
 * Highlight washes sit *under* the reading text (z-index) and are clipped to
 * text-node boxes so verse line-boxes do not tint glyphs orange.
 * epubjs annotations.highlight is used only when it actually paints visible marks.
 */

import {
  CfiLocation,
  Highlight,
  type OverlayPainter,
} from '@reading-book/domain'
import type { Rendition } from 'epubjs'
import type { HighlightHandleRect } from '@reading-book/shared/models'
import {
  cfiChapterSignature,
  elementFromCfi,
  findRangeByText,
  isTrivialSectionStartCfi,
  rangeBetweenBoundaries,
  rangeMatchesText,
  resolveCfiBoundary,
  resolveCfiRange,
  splitCfiComponents,
  withEpubjsStartContainerLogMuted,
  type CfiDomOptions,
  elementToHighlightHandleRect,
  emptyHighlightHandleRect,
  rangeToHighlightHandleRect,
  splitCfiRange,
} from '../renderers/epub/cfi'

type AnnotationsApi = {
  highlight: (
    cfiRange: string,
    data?: Record<string, unknown>,
    cb?: (e: Event) => void,
    className?: string,
    styles?: Record<string, string>,
  ) => void
  remove: (cfiRange: string, type: string) => void
}

type EpubjsContentsLike = {
  document?: Document
  window?: Window
  range?: (cfi: string) => Range | null
  /** Spine component of CFIs rendered in this iframe, e.g. `/6/60`. */
  cfiBase?: string
}

type ThemeableRendition = Rendition & {
  getContents?: () => EpubjsContentsLike | EpubjsContentsLike[]
  annotations?: AnnotationsApi
}

export type DomCssOverlayMarkClick = {
  id: string
  cfiRange: string
  colorHex: string
  rect: HighlightHandleRect
  click: { x: number; y: number }
}

export type EpubPaintMark = {
  /** Prefer full range CFI for epubjs / contents.range. */
  cfiRange: string
  /** Point CFIs — used when full-range resolve fails. */
  locationStart: string
  locationEnd: string
  /** Captured text — verifies a resolved Range and re-anchors broken CFIs. */
  selectedText: string
  colorHex: string
  id: string
}

const LAYER_ATTR = 'data-rb-hl-layer'
const RECT_ATTR = 'data-rb-hl-id'
const STYLE_ATTR = 'data-rb-hl-style'
const LOG_PREFIX = '[DomCssOverlay]'

/** True when CFI looks like epubjs range form: epubcfi(base,start,end). */
function looksLikeRangeCfi(cfi: string): boolean {
  return splitCfiComponents(cfi).length >= 3
}

/**
 * Rebuild epubjs range CFI from two point CFIs when possible.
 * Point form: epubcfi(base,local) → range: epubcfi(base,startLocal,endLocal).
 */
export function rebuildRangeCfi(
  locationStart: string,
  locationEnd: string,
): string | null {
  const a = locationStart.trim()
  const b = locationEnd.trim()
  if (!a || !b) return null
  if (looksLikeRangeCfi(a)) return a
  if (looksLikeRangeCfi(b)) return b

  const parsePoint = (
    cfi: string,
  ): { base: string; local: string } | null => {
    const parts = splitCfiComponents(cfi)
    if (parts.length !== 2) return null
    return { base: parts[0], local: parts[1] }
  }

  const start = parsePoint(a)
  const end = parsePoint(b)
  if (!start || !end) return null
  if (start.base !== end.base) return null
  return `epubcfi(${start.base},${start.local},${end.local})`
}

/** Map domain highlights → paint marks (CFI range + point ends). */
export function highlightsToEpubMarks(
  highlights: Highlight[],
): EpubPaintMark[] {
  const marks: EpubPaintMark[] = []
  for (const h of highlights) {
    try {
      const { start, end } = Highlight.unpackLocation(h.location)
      if (!(start instanceof CfiLocation)) continue
      const startCfi = start.cfi.trim()
      if (!startCfi) continue
      const endCfi =
        end instanceof CfiLocation ? end.cfi.trim() : startCfi
      const split = splitCfiRange(startCfi)
      const locationStart = split.locationStart || startCfi
      const locationEnd =
        (endCfi && endCfi !== startCfi ? endCfi : split.locationEnd) ||
        locationStart
      const rebuilt = rebuildRangeCfi(locationStart, locationEnd)
      const cfiRange = looksLikeRangeCfi(startCfi)
        ? startCfi
        : rebuilt || startCfi
      marks.push({
        id: h.id,
        cfiRange,
        locationStart,
        locationEnd,
        selectedText: h.selectedText,
        colorHex: h.colorHex,
      })
    } catch {
      /* skip malformed packed location */
    }
  }
  return marks
}

function colorWithAlpha(hex: string, alpha: number): string {
  const raw = hex.trim().replace('#', '')
  let r = 0
  let g = 0
  let b = 0
  if (raw.length === 3) {
    r = Number.parseInt(raw[0] + raw[0], 16)
    g = Number.parseInt(raw[1] + raw[1], 16)
    b = Number.parseInt(raw[2] + raw[2], 16)
  } else if (raw.length === 6) {
    r = Number.parseInt(raw.slice(0, 2), 16)
    g = Number.parseInt(raw.slice(2, 4), 16)
    b = Number.parseInt(raw.slice(4, 6), 16)
  } else {
    return `rgba(245, 158, 11, ${alpha})`
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Rate-limit paint warnings — off-section / scroll repaints used to spam thousands. */
const paintFailLogAt = new Map<string, number>()
const PAINT_FAIL_LOG_COOLDOWN_MS = 8000

function logPaintFail(
  mark: EpubPaintMark,
  reason: string,
  detail?: Record<string, unknown>,
): void {
  const key = `${mark.id}:${reason}`
  const now = Date.now()
  const last = paintFailLogAt.get(key) ?? 0
  if (now - last < PAINT_FAIL_LOG_COOLDOWN_MS) return
  paintFailLogAt.set(key, now)
  console.warn(LOG_PREFIX, 'paint failed', {
    id: mark.id,
    cfiRange: mark.cfiRange,
    locationStart: mark.locationStart,
    locationEnd: mark.locationEnd,
    colorHex: mark.colorHex,
    reason,
    ...detail,
  })
}

/**
 * Reflow overlay painter for EPUB.
 * Full-reload strategy: clear then re-paint on every `paint()`.
 */
export class DomCssOverlay implements OverlayPainter {
  /** Tracks CFIs painted via epubjs annotations (legacy path). */
  private paintedViaAnnotations = new Set<string>()
  /** Tracks CFIs painted via our Range rect layers. */
  private paintedViaRects = new Set<string>()
  private onMarkClick: ((mark: DomCssOverlayMarkClick) => void) | undefined
  private lastHighlights: Highlight[] = []
  /** iframe documents that already have our geometry hit-test listener. */
  private hitTestBound = new WeakSet<Document>()
  /**
   * While true, `paint()` is a no-op that just remembers the latest request.
   * A CFI jump (`goToLocation`) suspends painting for its duration: the
   * `paintMarkWithAnnotations` fallback mutates the DOM (wraps the target
   * text in a `<mark>`), which shifts child-node offsets out from under the
   * *same* CFI epub.js's own `locationOf` is mid-computation for, throwing
   * `IndexSizeError` and making epub.js fall back to the section's top. See
   * `openEpubjs.ts`'s `goToLocation`, which pairs with `suspend`/`resume`.
   */
  private suspended = false
  private pendingPaint: { highlights?: Highlight[] } | null = null
  /** Our own layers must stay invisible to CFI indexing and text re-anchoring. */
  private readonly cfiDomOptions: CfiDomOptions = {
    isIgnoredElement: (el) => {
      if (
        el.hasAttribute(LAYER_ATTR) ||
        el.hasAttribute(RECT_ATTR) ||
        el.hasAttribute(STYLE_ATTR) ||
        el.hasAttribute('data-rb-tw-layer') ||
        el.hasAttribute('data-rb-tw-note') ||
        el.hasAttribute('data-rb-tw-draft') ||
        el.hasAttribute('data-rb-tw-style') ||
        el.closest?.('[data-rb-tw-layer]') ||
        el.hasAttribute('data-rb-ink-layer') ||
        el.hasAttribute('data-rb-ink-stroke') ||
        el.hasAttribute('data-rb-ink-draft') ||
        el.hasAttribute('data-rb-ink-style') ||
        el.hasAttribute('data-rb-ink-svg') ||
        el.closest?.('[data-rb-ink-layer]')
      ) {
        return true
      }
      const className = el.getAttribute('class') ?? ''
      return className.includes('epubjs-hl') || className.includes('rb-epub-hl')
    },
  }

  constructor(
    private rendition: ThemeableRendition,
    private host: HTMLElement,
  ) {}

  /** Rebind after a rare rendition swap (normally set once in openEpubjs). */
  attachToRendition(rendition: Rendition): void {
    this.rendition = rendition as ThemeableRendition
    this.paintedViaAnnotations.clear()
    this.paintedViaRects.clear()
    this.hitTestBound = new WeakSet()
  }

  setOnMarkClick(
    handler: ((mark: DomCssOverlayMarkClick) => void) | undefined,
  ): void {
    this.onMarkClick = handler
  }

  /** Last paint payload — used by scheduleRepaint after `rendered` / typography. */
  getLastHighlights(): Highlight[] {
    return this.lastHighlights
  }

  /**
   * Geometry hit-test at iframe-local client coords (washes are pointer-events: none).
   * Used by Hand-mode pointerup so annotation taps do not toggle reader chrome.
   */
  hitTestMarkAt(
    clientX: number,
    clientY: number,
    doc?: Document | null,
  ): DomCssOverlayMarkClick | null {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null
    const docs = doc
      ? [doc]
      : this.contentsList()
          .map((c) => c.document)
          .filter((d): d is Document => !!d)

    for (const d of docs) {
      const hit = this.findMarkElementAt(d, clientX, clientY)
      if (!hit) continue
      return this.markClickFromHit(hit, { x: clientX, y: clientY }, d)
    }
    return null
  }

  /** Pause DOM-mutating repaints — see `suspended` field comment. */
  suspend(): void {
    this.suspended = true
  }

  /**
   * Resume painting and repaint. Prefers the request queued while suspended;
   * otherwise falls back to the last known highlight list, since a caller
   * that cleared marks before suspending (see `goToLocation`) relies on this
   * to always repaint something rather than leaving marks blank.
   */
  resume(): void {
    this.suspended = false
    const pending = this.pendingPaint ?? { highlights: this.lastHighlights }
    this.pendingPaint = null
    void this.paint(pending)
  }

  async paint(overlays: { highlights?: Highlight[] }): Promise<void> {
    if (this.suspended) {
      this.pendingPaint = overlays
      return
    }
    const list = overlays.highlights ?? []
    this.lastHighlights = list
    await this.clear()
    // Drop leftover native selection so its amber wash does not stack on our marks.
    this.clearNativeSelections()
    const marks = highlightsToEpubMarks(list)
    if (marks.length === 0) return

    const contents = this.contentsList()
    for (const mark of marks) {
      // Skip quietly — highlights of other spine sections are not paintable here.
      // Logging these on every `rendered`/scroll was flooding the console.
      if (!contents.some((c) => this.belongsToRenderedSection(c, mark))) {
        continue
      }

      const paintedRects = this.paintMarkWithRects(mark)
      if (paintedRects) {
        this.paintedViaRects.add(mark.cfiRange)
        continue
      }

      const paintedAnnCfi = this.paintMarkWithAnnotations(mark)
      if (paintedAnnCfi) {
        this.paintedViaAnnotations.add(paintedAnnCfi)
        continue
      }

      logPaintFail(mark, 'all_strategies_failed', {
        tried: [
          'text_reanchor',
          'tolerant_range_cfi',
          'tolerant_start_end_points',
          'epubjs_range_cfi',
          'epubjs_start_end_points',
          'epubjs_annotations',
        ],
      })
    }
  }

  private clearNativeSelections(): void {
    for (const contents of this.contentsList()) {
      try {
        contents.window?.getSelection()?.removeAllRanges()
      } catch {
        /* ignore */
      }
      try {
        contents.document?.defaultView?.getSelection()?.removeAllRanges()
      } catch {
        /* ignore */
      }
    }
  }

  async clear(): Promise<void> {
    const annotations = this.rendition.annotations
    if (annotations) {
      for (const cfi of this.paintedViaAnnotations) {
        try {
          annotations.remove(cfi, 'highlight')
        } catch {
          /* ignore */
        }
      }
    }
    this.paintedViaAnnotations.clear()

    for (const contents of this.contentsList()) {
      const doc = contents.document
      if (!doc) continue
      doc.querySelectorAll(`[${LAYER_ATTR}]`).forEach((el) => el.remove())
    }
    this.paintedViaRects.clear()
  }

  /** Primary: CFI → Range → line rects (any HTML structure). */
  private paintMarkWithRects(mark: EpubPaintMark): boolean {
    let painted = false

    for (const contents of this.contentsList()) {
      const doc = contents.document
      if (!doc) continue

      const range = this.resolveRange(contents, mark)
      if (!range || range.collapsed) continue

      const rects = this.collectPaintRects(range)
      if (rects.length === 0) continue

      const layer = this.ensureLayer(doc)
      const body = doc.body
      if (!body) continue
      const bodyRect = body.getBoundingClientRect()

      for (const r of rects) {
        const el = doc.createElement('span')
        el.setAttribute(RECT_ATTR, mark.id)
        el.setAttribute('data-rb-hl-cfi', mark.cfiRange)
        el.setAttribute('data-rb-hl-color', mark.colorHex)
        el.className = 'rb-dom-hl-rect'
        el.style.position = 'absolute'
        el.style.left = `${Math.round(r.left - bodyRect.left)}px`
        el.style.top = `${Math.round(r.top - bodyRect.top)}px`
        el.style.width = `${Math.max(1, Math.round(r.width))}px`
        el.style.height = `${Math.max(1, Math.round(r.height))}px`
        el.style.background = colorWithAlpha(mark.colorHex, 0.38)
        el.style.borderRadius = '2px'
        // Visual wash only — sits under glyphs; clicks use geometry hit-test.
        el.style.pointerEvents = 'none'
        el.style.mixBlendMode = 'normal'
        layer.appendChild(el)
      }
      painted = true
    }

    return painted
  }

  /**
   * Resolve a DOM Range for the mark:
   * 1) CFI strategies (tolerant → epubjs)
   * 2) Text re-anchor (exact `selectedText`) — preferred over a truncated CFI
   * 3) Expand a CFI prefix using text search near that prefix
   *
   * Never paint a short CFI clamp when `selectedText` says the mark is longer.
   */
  private resolveRange(
    contents: EpubjsContentsLike,
    mark: EpubPaintMark,
  ): Range | null {
    const doc = contents.document
    if (!doc) return null
    // Off-section marks must not call epubjs.range — it console.logs
    // `No startContainer found` instead of throwing.
    if (!this.belongsToRenderedSection(contents, mark)) return null

    const hasText = mark.selectedText.trim().length > 0
    const scope =
      elementFromCfi(doc, mark.locationStart, this.cfiDomOptions) ??
      elementFromCfi(doc, mark.cfiRange, this.cfiDomOptions)

    const rebuilt = rebuildRangeCfi(mark.locationStart, mark.locationEnd)
    const cfiStrategies: Array<() => Range | null> = [
      () => this.rangeFromTolerantCfi(doc, mark.cfiRange),
      () =>
        rebuilt && rebuilt !== mark.cfiRange
          ? this.rangeFromTolerantCfi(doc, rebuilt)
          : null,
      () =>
        this.rangeFromTolerantPointCfis(
          doc,
          mark.locationStart,
          mark.locationEnd,
        ),
      () => this.rangeFromEpubjs(contents, mark.cfiRange),
      () =>
        rebuilt && rebuilt !== mark.cfiRange
          ? this.rangeFromEpubjs(contents, rebuilt)
          : null,
      () =>
        this.rangeFromPointCfis(
          contents,
          mark.locationStart,
          mark.locationEnd,
        ),
    ]

    let cfiHint: Range | null = null

    for (const resolve of cfiStrategies) {
      let range: Range | null = null
      try {
        range = resolve()
      } catch {
        range = null
      }
      if (!range || range.collapsed) continue
      if (hasText && rangeMatchesText(range, mark.selectedText)) return range
      if (!hasText) return range
      cfiHint ??= range
    }

    // Exact text re-anchor (body-wide). Prefer occurrence near the CFI hit.
    if (hasText) {
      try {
        const byText = findRangeByText(
          doc,
          scope,
          mark.selectedText,
          this.cfiDomOptions,
          cfiHint,
        )
        if (byText && !byText.collapsed) return byText
      } catch {
        /* ignore */
      }
    }

    // No exact text match after CFI + re-anchor. Refuse truncated / over-long
    // clamps — painting a first-line wash is worse than leaving the mark for
    // the annotations fallback (or a later repaint).
    return hasText ? null : cfiHint
  }

  /** Unknown spine base counts as a match so paint never regresses on it. */
  private belongsToRenderedSection(
    contents: EpubjsContentsLike,
    mark: EpubPaintMark,
  ): boolean {
    const rendered = cfiChapterSignature(contents.cfiBase ?? '')
    if (!rendered) return true
    const marked =
      cfiChapterSignature(mark.cfiRange) ??
      cfiChapterSignature(mark.locationStart)
    return !marked || marked === rendered
  }

  /** epubjs `Contents.range` — throws on offsets it cannot patch, so guard it. */
  private rangeFromEpubjs(
    contents: EpubjsContentsLike,
    cfi: string,
  ): Range | null {
    const trimmed = cfi.trim()
    if (!trimmed || !contents.range) return null
    // Skip CFIs epubjs logs for without throwing (body with no leading text node).
    if (isTrivialSectionStartCfi(trimmed)) return null
    try {
      return (
        withEpubjsStartContainerLogMuted(() => contents.range!(trimmed)) ?? null
      )
    } catch {
      return null
    }
  }

  private rangeFromTolerantCfi(doc: Document, cfi: string): Range | null {
    if (!cfi.trim()) return null
    return resolveCfiRange(doc, cfi.trim(), this.cfiDomOptions)
  }

  private rangeFromTolerantPointCfis(
    doc: Document,
    locationStart: string,
    locationEnd: string,
  ): Range | null {
    const start = resolveCfiBoundary(
      doc,
      locationStart.trim(),
      this.cfiDomOptions,
      false,
    )
    const end = resolveCfiBoundary(
      doc,
      locationEnd.trim(),
      this.cfiDomOptions,
      true,
    )
    if (!start || !end) return null
    return rangeBetweenBoundaries(doc, start, end)
  }

  /** Build Range by combining start/end point CFI boundary points. */
  private rangeFromPointCfis(
    contents: EpubjsContentsLike,
    locationStart: string,
    locationEnd: string,
  ): Range | null {
    const doc = contents.document
    if (!doc || !contents.range) return null
    const startCfi = locationStart.trim()
    const endCfi = locationEnd.trim()
    if (!startCfi || !endCfi) return null
    if (
      isTrivialSectionStartCfi(startCfi) ||
      isTrivialSectionStartCfi(endCfi)
    ) {
      return null
    }

    let startRange: Range | null = null
    let endRange: Range | null = null
    try {
      startRange = withEpubjsStartContainerLogMuted(() =>
        contents.range!(startCfi),
      )
    } catch {
      startRange = null
    }
    try {
      endRange = withEpubjsStartContainerLogMuted(() => contents.range!(endCfi))
    } catch {
      endRange = null
    }
    if (!startRange || !endRange) return null

    try {
      const range = doc.createRange()
      range.setStart(startRange.startContainer, startRange.startOffset)
      // Point CFIs often collapse; prefer end boundary of endRange when non-collapsed.
      if (endRange.collapsed) {
        range.setEnd(endRange.startContainer, endRange.startOffset)
      } else {
        range.setEnd(endRange.endContainer, endRange.endOffset)
      }
      if (!range.collapsed) return range

      // Points may be reversed depending on selection direction.
      const swapped = doc.createRange()
      swapped.setStart(endRange.startContainer, endRange.startOffset)
      swapped.setEnd(startRange.startContainer, startRange.startOffset)
      return swapped.collapsed ? null : swapped
    } catch {
      return null
    }
  }

  /**
   * Secondary: epubjs annotations API.
   * Only keeps the annotation when visible paint is detected; otherwise removes
   * immediately to avoid blank / white artifact boxes on verse markup.
   * @returns the CFI that was registered, or null
   */
  private paintMarkWithAnnotations(mark: EpubPaintMark): string | null {
    const annotations = this.rendition.annotations
    if (!annotations) return null
    // annotations.highlight → contents.range; skip off-section / trivial CFIs.
    const onScreen = this.contentsList().some((contents) =>
      this.belongsToRenderedSection(contents, mark),
    )
    if (!onScreen) return null

    const cfisToTry = [
      mark.cfiRange,
      rebuildRangeCfi(mark.locationStart, mark.locationEnd),
    ].filter(
      (c, i, arr): c is string =>
        !!c && arr.indexOf(c) === i && !isTrivialSectionStartCfi(c),
    )

    for (const cfi of cfisToTry) {
      const before = this.countVisibleAnnotationNodes()
      try {
        withEpubjsStartContainerLogMuted(() => {
          annotations.highlight(
            cfi,
            { id: mark.id },
            (e: Event) => {
              const target = e.target as HTMLElement | null
              let rect = emptyHighlightHandleRect()
              try {
                rect = this.resolveHandleRectFromCfi(
                  { ...mark, cfiRange: cfi },
                  target,
                )
              } catch {
                /* ignore */
              }
              this.onMarkClick?.({
                id: mark.id,
                cfiRange: mark.cfiRange,
                colorHex: mark.colorHex,
                rect,
                click: this.viewportPointFromIframeEvent(e, target),
              })
            },
            'rb-epub-hl',
            {
              fill: mark.colorHex,
              'fill-opacity': '0.38',
              'mix-blend-mode': 'normal',
            },
          )
        })
      } catch (err) {
        logPaintFail(mark, 'annotations_threw', {
          cfi,
          error: err instanceof Error ? err.message : String(err),
        })
        continue
      }

      const after = this.countVisibleAnnotationNodes()
      if (after > before) {
        return cfi
      }

      // Remove invisible / artifact annotation immediately.
      try {
        annotations.remove(cfi, 'highlight')
      } catch {
        /* ignore */
      }
      logPaintFail(mark, 'annotations_no_visible_paint', { cfi, before, after })
    }

    return null
  }

  private countVisibleAnnotationNodes(): number {
    let n = 0
    for (const contents of this.contentsList()) {
      const doc = contents.document
      if (!doc) continue
      doc
        .querySelectorAll(
          '.rb-epub-hl, g.rb-epub-hl, .epubjs-hl, [class*="epubjs-hl"]',
        )
        .forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.width >= 1 && r.height >= 1) n += 1
        })
    }
    return n
  }

  private contentsList(): EpubjsContentsLike[] {
    const raw = this.rendition.getContents?.() ?? []
    return (Array.isArray(raw) ? raw : [raw]) as EpubjsContentsLike[]
  }

  private ensureLayer(doc: Document): HTMLElement {
    this.ensureHighlightStyles(doc)
    this.bindMarkHitTest(doc)
    const body = doc.body
    if (body) {
      const pos = doc.defaultView?.getComputedStyle(body).position
      if (!pos || pos === 'static') {
        body.style.position = 'relative'
      }
    }
    let layer = doc.querySelector(`[${LAYER_ATTR}]`) as HTMLElement | null
    if (!layer) {
      layer = doc.createElement('div')
      layer.setAttribute(LAYER_ATTR, '1')
      layer.className = 'rb-dom-hl-layer'
    }
    // Keep the wash under glyphs: first child + z-index 0; content elevated via CSS.
    layer.style.position = 'absolute'
    layer.style.left = '0'
    layer.style.top = '0'
    layer.style.width = '0'
    layer.style.height = '0'
    layer.style.overflow = 'visible'
    layer.style.pointerEvents = 'none'
    layer.style.zIndex = '0'
    const host = body ?? doc.documentElement
    if (layer.parentNode !== host || host.firstChild !== layer) {
      host.insertBefore(layer, host.firstChild)
    }
    return layer
  }

  private ensureHighlightStyles(doc: Document): void {
    let style = doc.querySelector(`style[${STYLE_ATTR}]`) as HTMLStyleElement | null
    if (!style) {
      style = doc.createElement('style')
      style.setAttribute(STYLE_ATTR, '1')
      ;(doc.head ?? doc.documentElement).appendChild(style)
    }
    // Rewrite every paint so HMR / older iframes pick up stacking + clip rules.
    style.textContent = `
      .rb-dom-hl-layer {
        position: absolute; left: 0; top: 0; width: 0; height: 0;
        overflow: visible; pointer-events: none; z-index: 0;
      }
      .rb-dom-hl-rect {
        pointer-events: none;
        cursor: pointer;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
      }
      /* Reading content above highlight wash — glyphs keep theme color.
         Typewriter layer stays excluded so its absolute stack is preserved. */
      body > *:not([${LAYER_ATTR}]):not([data-rb-tw-layer]):not([data-rb-ink-layer]) {
        position: relative;
        z-index: 1;
      }
      .rb-epub-hl, g.rb-epub-hl, .epubjs-hl { mix-blend-mode: normal !important; }
    `
  }

  /**
   * Geometry hit-test: washes sit under text so they cannot receive clicks.
   * Capture-phase listener maps the point onto painted rect boxes instead.
   */
  private bindMarkHitTest(doc: Document): void {
    if (this.hitTestBound.has(doc)) return
    this.hitTestBound.add(doc)
    doc.addEventListener('click', this.onDocumentMarkClick, true)
  }

  private findMarkElementAt(
    doc: Document,
    clientX: number,
    clientY: number,
  ): HTMLElement | null {
    let hit: HTMLElement | null = null
    for (const node of doc.querySelectorAll(`[${RECT_ATTR}]`)) {
      const el = node as HTMLElement
      const r = el.getBoundingClientRect()
      if (
        clientX >= r.left &&
        clientX <= r.right &&
        clientY >= r.top &&
        clientY <= r.bottom
      ) {
        hit = el
      }
    }
    return hit
  }

  private markClickFromHit(
    hitEl: HTMLElement,
    iframePoint: { x: number; y: number },
    doc: Document,
  ): DomCssOverlayMarkClick {
    const id = hitEl.getAttribute(RECT_ATTR) ?? ''
    const cfiRange = hitEl.getAttribute('data-rb-hl-cfi') ?? ''
    const colorHex = hitEl.getAttribute('data-rb-hl-color') ?? '#f59e0b'
    const mark =
      highlightsToEpubMarks(this.lastHighlights).find((m) => m.id === id) ?? {
        id,
        cfiRange,
        locationStart: splitCfiRange(cfiRange).locationStart || cfiRange,
        locationEnd: splitCfiRange(cfiRange).locationEnd || cfiRange,
        selectedText: '',
        colorHex,
      }

    let rect = emptyHighlightHandleRect()
    try {
      rect = this.resolveHandleRectFromCfi(mark, hitEl)
    } catch {
      /* ignore */
    }

    const view = doc.defaultView
    const synthetic = {
      clientX: iframePoint.x,
      clientY: iframePoint.y,
      view,
    } as MouseEvent

    return {
      id: mark.id,
      cfiRange: mark.cfiRange,
      colorHex: mark.colorHex,
      rect,
      click: this.viewportPointFromIframeEvent(synthetic, hitEl),
    }
  }

  private onDocumentMarkClick = (event: MouseEvent): void => {
    if (!this.onMarkClick) return
    const doc =
      event.view?.document ??
      ((event.target as Node | null)?.ownerDocument ?? null)
    if (!doc) return

    const hit = this.findMarkElementAt(doc, event.clientX, event.clientY)
    if (!hit) return

    event.preventDefault()
    event.stopPropagation()

    this.onMarkClick(
      this.markClickFromHit(hit, { x: event.clientX, y: event.clientY }, doc),
    )
  }

  /**
   * Collect paint boxes for a Range.
   * Prefer per-text-node rects so poetry `<br>` line-boxes (full column width)
   * do not become wide amber bars that tint the glyphs.
   */
  private collectPaintRects(range: Range): DOMRect[] {
    let list: DOMRect[] = []
    try {
      list = this.rectsFromTextNodes(range)
      if (list.length === 0) {
        list = Array.from(range.getClientRects())
      }
    } catch {
      return []
    }
    const usable = list.filter((r) => r.width >= 1 && r.height >= 1)
    if (usable.length === 0) return []

    const heights = usable.map((r) => r.height).sort((a, b) => a - b)
    const medianH = heights[Math.floor(heights.length / 2)] ?? 18
    let boundsW = 0
    try {
      boundsW = range.getBoundingClientRect().width
    } catch {
      boundsW = 0
    }
    // Drop absurd full-page / full-column boxes when tighter text rects exist.
    // Cap width by the range bounds (plus slack), not median fragment width —
    // a short first line must not cause later full-width lines to be dropped.
    const maxW = Math.max(boundsW * 1.15, 480, 240)
    const sane = usable.filter(
      (r) =>
        r.height <= Math.max(medianH * 3.5, 48) &&
        r.width <= maxW &&
        r.width <= 2400,
    )
    return sane.length > 0 ? sane : usable
  }

  /** Client rects from each text node intersecting the range (tight glyph boxes). */
  private rectsFromTextNodes(range: Range): DOMRect[] {
    const rootNode = range.commonAncestorContainer
    const doc =
      rootNode.nodeType === Node.DOCUMENT_NODE
        ? (rootNode as Document)
        : rootNode.ownerDocument
    if (!doc) return []

    const root =
      rootNode.nodeType === Node.ELEMENT_NODE ||
      rootNode.nodeType === Node.DOCUMENT_NODE
        ? rootNode
        : rootNode.parentNode
    if (!root) return []

    const out: DOMRect[] = []
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode() as Text | null
    while (node) {
      if (!range.intersectsNode(node)) {
        node = walker.nextNode() as Text | null
        continue
      }
      const start = node === range.startContainer ? range.startOffset : 0
      const end =
        node === range.endContainer ? range.endOffset : node.data.length
      if (start < end) {
        try {
          const sub = doc.createRange()
          sub.setStart(node, start)
          sub.setEnd(node, end)
          for (const r of Array.from(sub.getClientRects())) {
            if (r.width >= 1 && r.height >= 1) out.push(r)
          }
        } catch {
          /* ignore invalid offsets */
        }
      }
      node = walker.nextNode() as Text | null
    }
    return out
  }

  private resolveHandleRectFromCfi(
    mark: EpubPaintMark,
    fallbackEl?: Element | null,
  ): HighlightHandleRect {
    for (const contents of this.contentsList()) {
      const range = this.resolveRange(contents, mark)
      if (!range) continue
      const frameEl =
        (contents.document?.defaultView?.frameElement as HTMLElement | null) ??
        (this.host.querySelector('iframe') as HTMLElement | null)
      return rangeToHighlightHandleRect(range, frameEl)
    }

    if (fallbackEl) {
      const frameEl =
        (fallbackEl.ownerDocument?.defaultView
          ?.frameElement as HTMLElement | null) ??
        (this.host.querySelector('iframe') as HTMLElement | null)
      return (
        elementToHighlightHandleRect(fallbackEl, frameEl) ??
        emptyHighlightHandleRect()
      )
    }
    return emptyHighlightHandleRect()
  }

  private viewportPointFromIframeEvent(
    event: Event,
    target: Element | null,
  ): { x: number; y: number } {
    const mouse = event as MouseEvent
    const view =
      target?.ownerDocument?.defaultView ??
      (mouse.view as Window | null) ??
      null
    const frameEl =
      (view?.frameElement as HTMLElement | null) ??
      (this.host.querySelector('iframe') as HTMLElement | null)

    const fromTarget = (): { x: number; y: number } | null => {
      if (!target || typeof target.getBoundingClientRect !== 'function') {
        return null
      }
      const r = target.getBoundingClientRect()
      if (r.width <= 0 && r.height <= 0) return null
      const local = {
        x: r.left + r.width / 2,
        y: r.top + Math.min(24, r.height / 2),
      }
      if (!frameEl) return local
      const fr = frameEl.getBoundingClientRect()
      if (r.left >= fr.left - 1 && r.top >= fr.top - 1) return local
      return { x: fr.left + local.x, y: fr.top + local.y }
    }

    const cx = mouse.clientX
    const cy = mouse.clientY
    if (
      typeof cx === 'number' &&
      typeof cy === 'number' &&
      Number.isFinite(cx) &&
      Number.isFinite(cy) &&
      (Math.abs(cx) > 1 || Math.abs(cy) > 1)
    ) {
      if (frameEl && view && view !== window) {
        const fr = frameEl.getBoundingClientRect()
        return { x: fr.left + cx, y: fr.top + cy }
      }
      return { x: cx, y: cy }
    }

    return fromTarget() ?? { x: 0, y: 0 }
  }
}
