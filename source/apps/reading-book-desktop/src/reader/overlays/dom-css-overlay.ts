/**
 * DomCssOverlay — EPUB reflow highlight painter (T5.3 / SDS OverlayPainter).
 *
 * Primary paint: resolve CFI → DOM Range → per-line rect overlays.
 * Works for poetry / <br> / span / div — not only simple <p> blocks.
 * When full-range CFI fails, rebuild Range from start/end point CFIs.
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
  elementToHighlightHandleRect,
  emptyHighlightHandleRect,
  rangeToHighlightHandleRect,
  splitCfiRange,
} from '../renderers/epub/selection-cfi'

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
  colorHex: string
  id: string
}

const LAYER_ATTR = 'data-rb-hl-layer'
const RECT_ATTR = 'data-rb-hl-id'
const STYLE_ATTR = 'data-rb-hl-style'
const LOG_PREFIX = '[DomCssOverlay]'

/** True when CFI looks like epubjs range form: epubcfi(base,start,end). */
function looksLikeRangeCfi(cfi: string): boolean {
  const trimmed = cfi.trim()
  if (!trimmed.startsWith('epubcfi(') || !trimmed.endsWith(')')) return false
  const inner = trimmed.slice('epubcfi('.length, -1)
  let depth = 0
  let commas = 0
  for (const ch of inner) {
    if (ch === '[') depth += 1
    else if (ch === ']') depth = Math.max(0, depth - 1)
    else if (ch === ',' && depth === 0) commas += 1
  }
  return commas >= 2
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
    if (!cfi.startsWith('epubcfi(') || !cfi.endsWith(')')) return null
    const inner = cfi.slice('epubcfi('.length, -1)
    let depth = 0
    let comma = -1
    for (let i = 0; i < inner.length; i += 1) {
      const ch = inner[i]
      if (ch === '[') depth += 1
      else if (ch === ']') depth = Math.max(0, depth - 1)
      else if (ch === ',' && depth === 0) {
        comma = i
        break
      }
    }
    if (comma <= 0) return null
    return {
      base: inner.slice(0, comma).trim(),
      local: inner.slice(comma + 1).trim(),
    }
  }

  const start = parsePoint(a)
  const end = parsePoint(b)
  if (!start || !end) return null
  if (start.base !== end.base) return null
  if (!start.local || !end.local) return null
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

function logPaintFail(
  mark: EpubPaintMark,
  reason: string,
  detail?: Record<string, unknown>,
): void {
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

  constructor(
    private rendition: ThemeableRendition,
    private host: HTMLElement,
  ) {}

  /** Rebind after a rare rendition swap (normally set once in openEpubjs). */
  attachToRendition(rendition: Rendition): void {
    this.rendition = rendition as ThemeableRendition
    this.paintedViaAnnotations.clear()
    this.paintedViaRects.clear()
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

  async paint(overlays: { highlights?: Highlight[] }): Promise<void> {
    const list = overlays.highlights ?? []
    this.lastHighlights = list
    await this.clear()
    const marks = highlightsToEpubMarks(list)
    if (marks.length === 0) return

    for (const mark of marks) {
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
        tried: ['range_full_cfi', 'range_start_end_points', 'epubjs_annotations'],
      })
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
    let sawContents = false
    let lastReason = 'no_contents'

    for (const contents of this.contentsList()) {
      const doc = contents.document
      if (!doc) continue
      sawContents = true

      const range = this.resolveRange(contents, mark)
      if (!range) {
        lastReason = 'cfi_range_unresolved'
        continue
      }
      if (range.collapsed) {
        lastReason = 'cfi_range_collapsed'
        continue
      }

      const rects = this.collectPaintRects(range)
      if (rects.length === 0) {
        lastReason = 'no_client_rects'
        continue
      }

      const layer = this.ensureLayer(doc)
      const body = doc.body
      if (!body) {
        lastReason = 'no_body'
        continue
      }
      const bodyRect = body.getBoundingClientRect()

      for (const r of rects) {
        const el = doc.createElement('span')
        el.setAttribute(RECT_ATTR, mark.id)
        el.setAttribute('data-rb-hl-cfi', mark.cfiRange)
        el.className = 'rb-dom-hl-rect'
        el.style.position = 'absolute'
        el.style.left = `${Math.round(r.left - bodyRect.left)}px`
        el.style.top = `${Math.round(r.top - bodyRect.top)}px`
        el.style.width = `${Math.max(1, Math.round(r.width))}px`
        el.style.height = `${Math.max(1, Math.round(r.height))}px`
        el.style.background = colorWithAlpha(mark.colorHex, 0.38)
        el.style.borderRadius = '2px'
        el.style.pointerEvents = 'auto'
        el.style.cursor = 'pointer'
        el.style.mixBlendMode = 'normal'
        el.style.zIndex = '5'
        el.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          const target = e.currentTarget as HTMLElement
          let rect = emptyHighlightHandleRect()
          try {
            rect = this.resolveHandleRectFromCfi(mark.cfiRange, target)
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
        })
        layer.appendChild(el)
      }
      painted = true
    }

    if (!painted && sawContents) {
      logPaintFail(mark, `rects_${lastReason}`)
    }
    return painted
  }

  /**
   * Resolve a DOM Range for the mark:
   * 1) full cfiRange via contents.range
   * 2) rebuild range CFI from start/end points, then contents.range
   * 3) join boundary points from start + end point CFIs
   */
  private resolveRange(
    contents: EpubjsContentsLike,
    mark: EpubPaintMark,
  ): Range | null {
    const tryRange = (cfi: string): Range | null => {
      if (!cfi.trim() || !contents.range) return null
      try {
        return contents.range(cfi.trim()) ?? null
      } catch {
        return null
      }
    }

    const fromFull = tryRange(mark.cfiRange)
    if (fromFull && !fromFull.collapsed) return fromFull

    const rebuilt = rebuildRangeCfi(mark.locationStart, mark.locationEnd)
    if (rebuilt && rebuilt !== mark.cfiRange) {
      const fromRebuilt = tryRange(rebuilt)
      if (fromRebuilt && !fromRebuilt.collapsed) return fromRebuilt
    }

    return this.rangeFromPointCfis(
      contents,
      mark.locationStart,
      mark.locationEnd,
    )
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

    let startRange: Range | null = null
    let endRange: Range | null = null
    try {
      startRange = contents.range(startCfi)
    } catch {
      startRange = null
    }
    try {
      endRange = contents.range(endCfi)
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

    const cfisToTry = [
      mark.cfiRange,
      rebuildRangeCfi(mark.locationStart, mark.locationEnd),
    ].filter((c, i, arr): c is string => !!c && arr.indexOf(c) === i)

    for (const cfi of cfisToTry) {
      const before = this.countVisibleAnnotationNodes()
      try {
        annotations.highlight(
          cfi,
          { id: mark.id },
          (e: Event) => {
            const target = e.target as HTMLElement | null
            let rect = emptyHighlightHandleRect()
            try {
              rect = this.resolveHandleRectFromCfi(cfi, target)
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
      layer.style.position = 'absolute'
      layer.style.left = '0'
      layer.style.top = '0'
      layer.style.width = '0'
      layer.style.height = '0'
      layer.style.overflow = 'visible'
      layer.style.pointerEvents = 'none'
      layer.style.zIndex = '5'
      ;(body ?? doc.documentElement).appendChild(layer)
    }
    return layer
  }

  private ensureHighlightStyles(doc: Document): void {
    if (doc.querySelector(`style[${STYLE_ATTR}]`)) return
    const style = doc.createElement('style')
    style.setAttribute(STYLE_ATTR, '1')
    style.textContent = `
      .rb-dom-hl-layer { position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: visible; pointer-events: none; z-index: 5; }
      .rb-dom-hl-rect { pointer-events: auto; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
      .rb-epub-hl, g.rb-epub-hl, .epubjs-hl { mix-blend-mode: normal !important; }
    `
    ;(doc.head ?? doc.documentElement).appendChild(style)
  }

  /**
   * Collect visible line boxes for a Range.
   * Filters zero-size / absurd full-page rects (common with verse wrappers).
   */
  private collectPaintRects(range: Range): DOMRect[] {
    let list: DOMRect[]
    try {
      list = Array.from(range.getClientRects())
    } catch {
      return []
    }
    const usable = list.filter((r) => r.width >= 1 && r.height >= 1)
    if (usable.length === 0) return []

    const heights = usable.map((r) => r.height).sort((a, b) => a - b)
    const medianH = heights[Math.floor(heights.length / 2)] ?? 18
    const sane = usable.filter(
      (r) => r.height <= Math.max(medianH * 3.5, 48) && r.width <= 2400,
    )
    return sane.length > 0 ? sane : usable
  }

  private resolveHandleRectFromCfi(
    cfi: string,
    fallbackEl?: Element | null,
  ): HighlightHandleRect {
    for (const contents of this.contentsList()) {
      let range: Range | null = null
      try {
        range = contents.range?.(cfi) ?? null
      } catch {
        range = null
      }
      if (!range) {
        range = this.rangeFromPointCfis(
          contents,
          splitCfiRange(cfi).locationStart || cfi,
          splitCfiRange(cfi).locationEnd || cfi,
        )
      }
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
