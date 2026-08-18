/**

 * EPUB freehand ink layer — strokes live inside the section iframe so they

 * scroll with book content (same pattern as typewriter / DomCss overlays).

 *

 * Points are normalized 0..1 in the SVG box (viewBox 0 0 1 1). Capture uses

 * the SVG screen CTM so strokes track the pointer under scroll / columns /

 * padding — same idea as ReadingCanvas unit-space ink.

 */



import type {

  FreehandDraftStroke,

  FreehandPoint,

  ReaderShapeAnnotation,

} from '@reading-book/shared/models'



export const INK_LAYER_ATTR = 'data-rb-ink-layer'

export const INK_STROKE_ATTR = 'data-rb-ink-stroke'

export const INK_DRAFT_ATTR = 'data-rb-ink-draft'

export const INK_STYLE_ATTR = 'data-rb-ink-style'

export const INK_SVG_ATTR = 'data-rb-ink-svg'



export type InkPaintableStroke = {

  id?: string

  points: FreehandPoint[]

  colorHex: string

  strokeWidth: number

}



function clamp01(value: number): number {

  if (!Number.isFinite(value)) return 0

  return Math.min(1, Math.max(0, value))

}



/** True when an element belongs to the in-iframe ink overlay. */

export function isInkOverlayElement(el: Element | null): boolean {

  if (!el?.closest) return false

  return Boolean(

    el.closest(

      `[${INK_LAYER_ATTR}], [${INK_STROKE_ATTR}], [${INK_DRAFT_ATTR}], [${INK_SVG_ATTR}]`,

    ),

  )

}



function inkHostBox(host: Element): { width: number; height: number } {

  return {

    width: Math.max(host.scrollWidth, host.clientWidth, 1),

    height: Math.max(host.scrollHeight, host.clientHeight, 1),

  }

}



/**

 * Ensure body is a positioning context and inject the ink mount layer + CSS.

 * Returns the layer element, or null if the iframe doc is not ready.

 */

export function ensureInkIframeLayer(doc: Document): HTMLElement | null {

  const host = doc.body ?? doc.documentElement

  if (!host) return null



  ensureInkIframeStyles(doc)



  const body = doc.body

  if (body) {

    const pos = doc.defaultView?.getComputedStyle(body).position

    if (!pos || pos === 'static') {

      body.style.position = 'relative'

    }

  }



  let layer = doc.querySelector(`[${INK_LAYER_ATTR}]`) as HTMLElement | null

  if (!layer) {

    layer = doc.createElement('div')

    layer.setAttribute(INK_LAYER_ATTR, '1')

    layer.className = 'rb-ink-layer'

  }



  layer.style.position = 'absolute'

  layer.style.left = '0'

  layer.style.top = '0'

  layer.style.width = '0'

  layer.style.height = '0'

  layer.style.overflow = 'visible'

  layer.style.pointerEvents = 'none'

  layer.style.zIndex = '8'



  if (layer.parentNode !== host) {

    host.appendChild(layer)

  }



  syncInkSvgSize(layer)

  return layer

}



function ensureInkSvg(layer: HTMLElement): SVGSVGElement {

  const doc = layer.ownerDocument

  let svg = layer.querySelector(

    `svg[${INK_SVG_ATTR}]`,

  ) as SVGSVGElement | null

  if (!svg) {

    svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')

    svg.setAttribute(INK_SVG_ATTR, '1')

    svg.setAttribute('class', 'rb-ink-svg')

    layer.appendChild(svg)

  }

  svg.style.position = 'absolute'

  svg.style.left = '0'

  svg.style.top = '0'

  svg.style.overflow = 'visible'

  svg.style.pointerEvents = 'none'

  return svg

}



/** Size the SVG to the host box; unit viewBox so 0..1 points map to the paint surface. */

function syncInkSvgSize(layer: HTMLElement): SVGSVGElement | null {

  const doc = layer.ownerDocument

  const host = doc.body ?? doc.documentElement

  if (!host) return null

  const { width, height } = inkHostBox(host)

  const svg = ensureInkSvg(layer)

  const w = Math.max(1, Math.ceil(width))

  const h = Math.max(1, Math.ceil(height))

  svg.setAttribute('width', String(w))

  svg.setAttribute('height', String(h))

  svg.setAttribute('viewBox', '0 0 1 1')

  svg.setAttribute('preserveAspectRatio', 'none')

  svg.style.width = `${w}px`

  svg.style.height = `${h}px`

  return svg

}



function ensureInkIframeStyles(doc: Document): void {

  const styleHost = doc.head ?? doc.documentElement

  if (!styleHost) return



  let style = doc.querySelector(

    `style[${INK_STYLE_ATTR}]`,

  ) as HTMLStyleElement | null

  if (!style) {

    style = doc.createElement('style')

    style.setAttribute(INK_STYLE_ATTR, '1')

    styleHost.appendChild(style)

  }



  style.textContent = `

    .rb-ink-layer {

      position: absolute; left: 0; top: 0; width: 0; height: 0;

      overflow: visible; pointer-events: none; z-index: 8;

    }

    .rb-ink-svg {

      position: absolute; left: 0; top: 0;

      overflow: visible; pointer-events: none;

    }

    .rb-ink-svg path {

      fill: none;

      stroke-linecap: round;

      stroke-linejoin: round;

      pointer-events: none;

      vector-effect: non-scaling-stroke;

    }

  `

}



/** Build an SVG path `d` from normalized 0..1 points in a host box (px space). */

export function freehandPointsToPathD(

  points: FreehandPoint[],

  hostWidth: number,

  hostHeight: number,

): string {

  if (points.length === 0 || hostWidth <= 0 || hostHeight <= 0) return ''

  const first = points[0]

  if (!first) return ''

  let d = `M ${first.x * hostWidth} ${first.y * hostHeight}`

  for (let i = 1; i < points.length; i += 1) {

    const p = points[i]

    if (!p) continue

    d += ` L ${p.x * hostWidth} ${p.y * hostHeight}`

  }

  return d

}



/** Path `d` in unit viewBox space (0..1). */

function freehandUnitPathD(points: FreehandPoint[]): string {

  const first = points[0]

  if (!first) return ''

  let d = `M ${first.x} ${first.y}`

  for (let i = 1; i < points.length; i += 1) {

    const p = points[i]

    if (!p) continue

    d += ` L ${p.x} ${p.y}`

  }

  return d

}



/**

 * Map iframe-local client coords → normalized 0..1 ink points.

 * Prefers SVG screen CTM so the stroke tracks the pointer on the paint surface.

 */

export function iframeClientToNormalizedInkPoint(

  doc: Document,

  iframeClientX: number,

  iframeClientY: number,

): FreehandPoint | null {

  const layer = ensureInkIframeLayer(doc)

  if (!layer) return null

  const svg = syncInkSvgSize(layer)

  if (!svg) return null



  const ctm = svg.getScreenCTM()

  if (ctm) {

    try {

      const inverse = ctm.inverse()

      const pt = svg.createSVGPoint()

      pt.x = iframeClientX

      pt.y = iframeClientY

      const local = pt.matrixTransform(inverse)

      return { x: clamp01(local.x), y: clamp01(local.y) }

    } catch {

      /* fall through to rect mapping */

    }

  }



  const rect = svg.getBoundingClientRect()

  if (rect.width <= 0 || rect.height <= 0) return null

  return {

    x: clamp01((iframeClientX - rect.left) / rect.width),

    y: clamp01((iframeClientY - rect.top) / rect.height),

  }

}



/**
 * Ink SVG box in the top-level viewport — same space freehand points use
 * (viewBox 0..1 via SVG CTM). Prefer this over the iframe element rect when
 * placing selection chrome / hit padding.
 */
export function inkSvgTopLevelRect(
  doc: Document,
): { left: number; top: number; width: number; height: number } | null {
  const layer = ensureInkIframeLayer(doc)
  if (!layer) return null
  const svg = syncInkSvgSize(layer)
  if (!svg) return null

  const frameEl = doc.defaultView?.frameElement as HTMLElement | null
  const fr = frameEl?.getBoundingClientRect()
  const ox = fr?.left ?? 0
  const oy = fr?.top ?? 0
  // Parent CSS zoom/transform scales the iframe's border box but not
  // iframe-local client/CTM coordinates — convert before lifting.
  const scaleX =
    fr && frameEl && frameEl.clientWidth > 0
      ? fr.width / frameEl.clientWidth
      : 1
  const scaleY =
    fr && frameEl && frameEl.clientHeight > 0
      ? fr.height / frameEl.clientHeight
      : 1

  // Capture uses getScreenCTM() with iframe-local client coords — map unit
  // corners the same way, then lift into the parent viewport.
  const ctm = svg.getScreenCTM()
  if (ctm) {
    try {
      const p0 = svg.createSVGPoint()
      p0.x = 0
      p0.y = 0
      const p1 = svg.createSVGPoint()
      p1.x = 1
      p1.y = 1
      const a = p0.matrixTransform(ctm)
      const b = p1.matrixTransform(ctm)
      const left = Math.min(a.x, b.x) * scaleX + ox
      const top = Math.min(a.y, b.y) * scaleY + oy
      const width = Math.abs(b.x - a.x) * scaleX
      const height = Math.abs(b.y - a.y) * scaleY
      if (width > 0 && height > 0) {
        return { left, top, width, height }
      }
    } catch {
      /* fall through */
    }
  }

  const rect = svg.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  // Parent-accessed rect may already be top-level; only add frame offset when
  // the SVG box still looks iframe-local (fits inside the frame size).
  const looksIframeLocal =
    Boolean(fr) &&
    rect.left >= -1 &&
    rect.top >= -1 &&
    rect.right <= (fr?.width ?? 0) + 2 &&
    rect.bottom <= (fr?.height ?? 0) + 2 &&
    ((fr?.left ?? 0) > 1 || (fr?.top ?? 0) > 1)

  if (looksIframeLocal && fr) {
    return {
      left: rect.left * scaleX + fr.left,
      top: rect.top * scaleY + fr.top,
      width: rect.width * scaleX,
      height: rect.height * scaleY,
    }
  }

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
}



function paintStrokePath(

  svg: SVGSVGElement,

  stroke: InkPaintableStroke,

  opts: { draft?: boolean },

): void {

  const d = freehandUnitPathD(stroke.points)

  if (!d) return

  const path = svg.ownerDocument.createElementNS(

    'http://www.w3.org/2000/svg',

    'path',

  )

  path.setAttribute('d', d)

  path.setAttribute('stroke', stroke.colorHex)

  path.setAttribute('stroke-width', String(Math.max(1, stroke.strokeWidth)))

  path.setAttribute('fill', 'none')

  path.setAttribute('stroke-linecap', 'round')

  path.setAttribute('stroke-linejoin', 'round')

  path.setAttribute('vector-effect', 'non-scaling-stroke')

  if (opts.draft) {

    path.setAttribute(INK_DRAFT_ATTR, '1')

  } else if (stroke.id) {

    path.setAttribute(INK_STROKE_ATTR, stroke.id)

  }

  svg.appendChild(path)

}



/**

 * Repaint committed (+ optional draft) strokes into the ink layer SVG.

 * Coordinates are normalized 0..1 against the SVG paint box.

 */

export function paintInkStrokes(

  layer: HTMLElement,

  strokes: readonly InkPaintableStroke[],

  draft?: InkPaintableStroke | null,

): void {

  const svg = syncInkSvgSize(layer)

  if (!svg) return



  while (svg.firstChild) {

    svg.removeChild(svg.firstChild)

  }



  for (const stroke of strokes) {

    paintStrokePath(svg, stroke, {})

  }

  if (draft && draft.points.length > 0) {

    paintStrokePath(svg, draft, { draft: true })

  }

}



export function readerShapeToInkStroke(

  shape: ReaderShapeAnnotation,

): InkPaintableStroke {

  return {

    id: shape.id,

    points: shape.points,

    colorHex: shape.colorHex,

    strokeWidth: shape.strokeWidth,

  }

}



export function draftToInkStroke(

  draft: FreehandDraftStroke,

): InkPaintableStroke {

  return {

    points: draft.points,

    colorHex: draft.colorHex,

    strokeWidth: draft.strokeWidth,

  }

}


