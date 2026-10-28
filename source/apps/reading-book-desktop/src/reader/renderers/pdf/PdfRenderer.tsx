/**
 * PDF surface — continuous vertical scrolling (see docs/implementation_plan/pdf_continuous_scroll.md).
 *
 * Every page gets a placeholder slot sized from its PDF viewport, stacked in document order. The
 * Reader's zoom viewport (`ReaderZoomViewport mode="native"`) is the one scroll container; this
 * component never scrolls itself. It lays pages out at `zoom` (no CSS transform), and only the
 * pages in / near the viewport hold a canvas + text layer — the rest are released on the way out.
 *
 * Navigation is exposed through `apiRef` so the shared Reader controls (footer, shortcuts, TOC)
 * drive it the same way they drive the EPUB renderer. Bytes come from `library.openBookContent`;
 * no file paths or Node APIs here.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  AnnotationMode,
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist'
import {
  PageRectLocation,
  clientToPageUnit,
  filterMinDistance,
  INK_ERASER_RADIUS_PX,
  erasePathsWithSweeps,
  canResizeInk,
  inkHandlePosition,
  inkOutlinesAvailable,
  inkSelectionBox,
  inkStrokesTouchedBySweep,
  type InkEraseSweep,
  isMarkupTool,
  pdfMarkAt,
  pdfGraphicAt,
  pdfShapeHit,
  moveShapeEndpoint,
  resizeShapeBox,
  shapeFromDrag,
  pickInkTarget,
  reduceInkInteraction,
  resizePdfGraphicBox,
  resizeInkPaths,
  simplifyInkPoints,
  translateInkPaths,
  type InkPenStyle,
  type InkPoint,
  type InkResizeHandle,
  type PdfGraphicBox,
  type PdfGraphicObject,
  type PdfShapeGeometryResult,
  type PdfShapeKind,
  type InteractionTool,
  type MarkupInteractionTool,
  type TextMatcher,
} from '@reading-book/book-reader-sdk'
import {
  createHandHoverDwell,
  exceedsDragThreshold,
  isInCenterTapZone,
  type HandHoverDwell,
} from '../../interaction'
import { pickSectionMatch, rangeForMatch } from '../epub/search/epubSearchDom'
import {
  buildPdfTextLayerIndex,
  clearPdfSearchHighlights,
  paintPdfSearchHighlights,
  pdfPageSearchRanges,
} from './pdfSearchDom'
import { PdfPageInk, type PdfInkLayerMark } from './PdfInkLayer'
import { PdfInkSelectionOverlay, type PdfCustomHandle } from './PdfInkSelectionOverlay'
import { typewriterBoxAt } from '@reading-book/book-reader-sdk'
import { PAN_DRAG_THRESHOLD_PX } from '../../interaction/interaction-hit'
import { PdfPageTypewriters, type PdfTypewriterFlash, type PdfTypewriterMark } from './PdfTypewriterLayer'
import { PdfPageShapes, type PdfShapeDraft, type PdfShapeFlash, type PdfShapeMark } from './PdfShapeLayer'
import { readPdfInsertionPoint, type PdfInsertionPoint } from './pdfInsertionPoint'
import { readPdfSelection, readPdfSelectionAt, type PdfSelectionInfo } from './pdfSelection'
import { attachTextLayerSelection, detachTextLayerSelection } from './pdfTextLayerSelection'
import {
  PdfPageAnnotations,
  type PdfAnnotationFlash,
  type PdfAnnotationMark,
} from './PdfAnnotationLayer'
import { PAD_PX, PAGE_GAP_PX, PDF_TO_CSS, type PdfPageCssSize } from './pdfLayout'
// `?url` makes Vite emit the worker as a local asset in dist/ — never loaded from a CDN.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/** Pages rendered beyond the visible range in each direction. */
const RENDER_AHEAD = 2
/** Rendered pages farther than this from the visible range are released. */
const KEEP_AROUND = 6
/** Cap one canvas' backing store (high zoom × HiDPI) — the page just gets a little softer. */
const MAX_CANVAS_PIXELS = 16_777_216
/** How long a search jump waits for the target page's text layer before giving up on the hit. */
const TEXT_LAYER_WAIT_MS = 4000
/** How long a jumped-to annotation pulses. */
const ANNOTATION_FLASH_MS = 1200
/** Extra reach around an annotation rect for a click, in CSS px. */
const ANNOTATION_HIT_SLOP_PX = 3
/** Stable empty list, so a page that only has a draft does not re-render its saved strokes. */
const NO_INK: readonly PdfInkLayerMark[] = []
/** Assumed page size (A4) until the first page is measured. */
const FALLBACK_SIZE: PageSize = { w: 595, h: 842 }
/** Duration of one page-turn in paged flow. */
const PAGE_TURN_MS = 480

type PageSize = { w: number; h: number }


/** A click / right-click that landed on an annotation; `rect` = its box (client px) to anchor UI. */
export type PdfAnnotationHit = { id: string; rect: DOMRect }

/** Markup tools (Highlight / Underline / Strikethrough): a drag that selects text marks it. */
type MarkupTool = MarkupInteractionTool

function markupToolOf(tool: InteractionTool): MarkupTool | null {
  return isMarkupTool(tool) ? tool : null
}

export type PdfNavState = {
  /** 1-based page currently being read. */
  pageCurrent: number
  pageTotal: number
}

export type PdfOutlineItem = {
  id: string
  label: string
  /** 1-based target page; null when the entry has no in-document destination (e.g. a URL). */
  page: number | null
  level: number
  children: PdfOutlineItem[]
}

export interface PdfRendererApi {
  goToPage: (page: number) => void
  /**
   * Scroll 1-based `page` into view with the normalized `y` (0–1 of the page height) near the top
   * third of the view — an annotation's position. `y` undefined behaves like `goToPage`.
   */
  goToPagePoint: (page: number, y?: number) => void
  /** Pulse an annotation's marks (after a jump from the sidebar). */
  flashAnnotation: (id: string) => void
  nextPage: () => void
  prevPage: () => void
  getNavState: () => PdfNavState
  getCurrentLocation: () => PageRectLocation | undefined
  /** Paint every hit of `matcher` on the rendered pages (kept across re-renders / zoom), or clear. */
  setSearchHighlights: (matcher: TextMatcher | null) => void
  /**
   * Scroll to Main's `occurrence`-th of `count` matches on 0-based page `pageIndex` and mark it as
   * the current hit (falls back to the page when its text layer can't be matched).
   */
  goToSearchMatch: (target: PdfSearchTarget) => Promise<void>
  /** Drop a text selection made in the PDF; false when there was none (Escape falls through). */
  clearSelection: () => boolean
  /**
   * Rasterize 1-based `page` into a new canvas `cssWidth` CSS px wide (Page layout thumbnails).
   * Thumbnail renders run one at a time (shared queue); null when aborted or unavailable.
   */
  renderThumbnail: (page: number, cssWidth: number, signal: AbortSignal) => Promise<HTMLCanvasElement | null>
  /** Measure 1-based `page` from the document itself (its own size and rotation); null if unavailable. */
  measurePage: (page: number) => Promise<PdfPageCssSize | null>
}

export type PdfSearchTarget = { pageIndex: number; occurrence: number; count: number }

export interface PdfRendererProps {
  data: ArrayBuffer
  /** Reader view zoom (1 = 100%); pages are laid out and rasterized at this scale. */
  zoom: number
  /** The scroll container (Reader zoom viewport) — used for page tracking and navigation. */
  getScrollRoot: () => HTMLElement | null
  /** 1-based page to open at (restored reading position). */
  initialPage?: number
  /**
   * Toolbar tool. `hand`: the shared Hand model (grab cursor; I-beam after resting on text, then a
   * press on text selects; any other press drags the pages). Anything else (`select`, and the markup
   * tools PDF doesn't offer yet): native text selection on the PDF.js text layer.
   */
  interactionTool?: InteractionTool
  /** Hand drag deltas — the Reader scrolls its zoom viewport (the PDF's one scroll container). */
  onHandPanBy?: (dx: number, dy: number) => void
  /** A plain click (no drag, no selection) in the middle half of the page area. */
  onCenterTap?: () => void
  /**
   * Right-click inside a live text selection on the text layer, at client (`x`, `y`) — the
   * Reader's own window coordinates (no iframe / transform on the PDF surface). The native context
   * menu is always suppressed on the pages; a right-click anywhere else fires nothing.
   */
  onSelectionContextMenu?: (selection: PdfSelectionInfo, x: number, y: number) => void
  /** Text markup to paint (normalized rects, see PdfAnnotationLayer). */
  annotations?: readonly PdfAnnotationMark[]
  /** The annotation whose marks get the focus outline. */
  focusedAnnotationId?: string | null
  /** A plain click (no drag, no selection) on an annotation's mark / note icon. */
  onAnnotationClick?: (hit: PdfAnnotationHit) => void
  /** The pointer moved onto (hit) or off (null) an annotation — drives the Replace preview. */
  onAnnotationHover?: (hit: PdfAnnotationHit | null) => void
  /** Right-click on an annotation (outside any live text selection). */
  onAnnotationContextMenu?: (hit: PdfAnnotationHit) => void
  /** A plain click that hit no annotation (anywhere on the pages) — dismisses annotation UI. */
  onBlankClick?: () => void
  /**
   * A Highlight / Underline / Strikethrough tool is armed and a press just ended with text
   * selected — the selection to mark with that tool.
   */
  onMarkupSelection?: (selection: PdfSelectionInfo, tool: MarkupTool) => void
  /** Insert Text tool: a click (or the end of a drag) at an insertion point between glyphs. */
  onInsertPoint?: (point: PdfInsertionPoint) => void
  /**
   * PDF.js ids of annotations embedded in the file that the app paints itself (imported into
   * `notes`, see pdf_embedded_annotation_import.md): their own appearance is not drawn on the canvas,
   * so a mark isn't painted twice and an edit / delete in the app shows. In-memory only.
   */
  hiddenEmbeddedAnnotationIds?: readonly string[]
  /** Pages shown side by side (1 single, 2 double, 3 triple). */
  pagesPerView?: 1 | 2 | 3
  /** `paged`: one spread at a time, turned with an animation; `scroll`: all spreads in one scroll. */
  flow?: 'paged' | 'scroll'
  apiRef?: MutableRefObject<PdfRendererApi | null>
  onNavState?: (state: PdfNavState) => void
  onOutline?: (items: PdfOutlineItem[]) => void
  /** Freehand Ink strokes to paint (normalized points; see PdfInkLayer). */
  inkStrokes?: readonly PdfInkLayerMark[]
  /** The selected stroke (halo). */
  selectedInkId?: string | null
  /** Pen settings shown on the stroke being drawn; a saved stroke takes its look from the store. */
  inkPen?: { colorHex: string; width: number; opacity: number; penStyle: InkPenStyle }
  /** A finished pen drag: 0-based `pageIndex` and the decimated page points. The Reader saves it. */
  onInkStroke?: (pageIndex: number, points: InkPoint[]) => void
  /** A click selected a stroke (`id`) or hit none (`null`). */
  onInkSelect?: (id: string | null) => void
  /** The Hand tool dragged the SELECTED stroke: shift it by (`dx`, `dy`) normalized page units (already clamped to the page). */
  onInkMove?: (id: string, dx: number, dy: number) => void
  /** A resize handle of the SELECTED stroke was released: its points, scaled (already clamped to the page). */
  onInkResize?: (id: string, paths: InkPoint[][]) => void
  /** The compact contextual toolbar (colour + Delete) shown next to the selected stroke. */
  renderInkToolbar?: (stroke: PdfInkLayerMark) => ReactNode
  /** Graphic objects that live inside the PDF file (made by another reader): hover, select, resize. */
  graphics?: readonly PdfGraphicObject[]
  selectedGraphicId?: string | null
  /** A click selected a file object (`id`) or hit none (`null`). */
  onGraphicSelect?: (id: string | null) => void
  /** A handle drag of the SELECTED file object was released: its new box (normalized, on the page). */
  onGraphicResize?: (id: string, box: PdfGraphicBox) => void
  /** The compact toolbar for the selected file object (only what its type allows). */
  renderGraphicToolbar?: (object: PdfGraphicObject) => ReactNode
  /** Shape annotations (rows of the app's annotation list) to paint and select; the Reader keeps them out of `annotations`. */
  shapes?: readonly PdfShapeMark[]
  selectedShapeId?: string | null
  /** A click selected a shape (`id`) or hit none (`null`). */
  onShapeSelect?: (id: string | null) => void
  /** The Shape tool's pen: what the NEXT shape is (kind, colour, thickness, opacity). */
  shapePen?: { kind: PdfShapeKind; colorHex: string; width: number; opacity: number }
  /** A finished Shape-tool drag: 0-based page, kind and the normalized geometry. The Reader saves it. */
  onShapeCreate?: (pageIndex: number, kind: PdfShapeKind, geometry: PdfShapeGeometryResult) => void
  /** A handle drag of the SELECTED shape was released: its new geometry. */
  onShapeResize?: (id: string, geometry: PdfShapeGeometryResult) => void
  /** The compact toolbar for the selected shape. */
  renderShapeToolbar?: (shape: PdfShapeMark) => ReactNode
  /** Typewriter notes (rows of the annotation list) to paint; the Reader keeps them out of `annotations`. */
  typewriters?: readonly PdfTypewriterMark[]
  /** True while a note is being typed: a press elsewhere commits it instead of placing another box. */
  typewriterEditing?: boolean
  /** The Typewriter tool placed a box (a click: `height` 0; a drag: its rectangle) on a page. The Reader opens the editor. */
  onTypewriterBegin?: (input: { pageIndex: number; box: { x: number; y: number; width: number; height: number }; heightRatio: number }) => void
  /** A press outside the open editor: commit it. */
  onTypewriterOutside?: () => void
  /** The selected Typewriter note (the focused annotation row), or null. */
  selectedTypewriterId?: string | null
  /** The note being edited in place: its saved copy is not painted (the editor paints it). */
  editingTypewriterId?: string | null
  /** A click selected a note (`id`) or hit none (`null`). Select mode / the tool: one click; Hand: double-click. */
  onTypewriterSelect?: (id: string | null) => void
  /** A move / resize of the SELECTED note was released: its new box and the page's height / width. */
  onTypewriterBox?: (id: string, box: { x: number; y: number; width: number; height: number }, heightRatio: number) => void
  /** The selected note should be edited in place (double-click, a second click in Select, the toolbar). */
  onTypewriterEdit?: (id: string, heightRatio: number) => void
  onTypewriterDelete?: (id: string) => void
  /** Right-click on a note, or its toolbar's Properties button: select it and show its properties. */
  onTypewriterProperties?: (id: string) => void
  /** The editor of the note being typed, for the page it is on (null elsewhere). */
  renderTypewriterEditor?: (pageIndex: number, heightRatio: number) => ReactNode
  /** The Eraser was released: delete these saved strokes (every one the gesture touched) as one operation. */
  onInkErase?: (ids: string[]) => void
  /** Stroke (whole strokes) or Partial (only the part under the eraser). Defaults to Stroke. */
  eraserMode?: 'stroke' | 'partial'
  /** The Partial Eraser was released: each touched stroke becomes its remaining `pieces` (empty: removed). */
  onInkPartialErase?: (edits: { id: string; pieces: InkPoint[][] }[]) => void
}

/** One primary-button press on the pages, from pointerdown to pointerup. */
type PointerGesture = {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  /** Travelled at least `PAN_DRAG_THRESHOLD_PX` — a drag, never a tap. */
  moved: boolean
  /** Hand press that pans (pointer captured, grabbing cursor) — not a text selection. */
  pan: boolean
  /** The selection's range when the press began (null: none) — to tell a new selection from a stale one. */
  selectionAtDown: Range | null
}

/** True when the live selection is a different range than `before` (the press changed it). */
function selectionChangedSince(before: Range | null): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  if (!before) return true
  const now = selection.getRangeAt(0)
  return (
    now.compareBoundaryPoints(Range.START_TO_START, before) !== 0 ||
    now.compareBoundaryPoints(Range.END_TO_END, before) !== 0
  )
}

/** Surface flags set imperatively (not through React) so CSS applies before the next event. */
type SurfaceFlag = 'data-pdf-hover-text' | 'data-pdf-grabbing' | 'data-pdf-has-selection' | 'data-pdf-ink-hover'

function hasTextSelection(): boolean {
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed && selection.toString().trim() !== ''
}

type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

type RenderEntry = {
  scale: number
  page: PDFPageProxy | null
  task: ReturnType<PDFPageProxy['render']> | null
  textLayer: TextLayer | null
  canvas: HTMLCanvasElement | null
  text: HTMLDivElement | null
}

function isCancelled(err: unknown): boolean {
  return err instanceof Error && (err.name === 'RenderingCancelledException' || err.name === 'AbortException')
}

async function resolveOutline(doc: PDFDocumentProxy): Promise<PdfOutlineItem[]> {
  const outline = await doc.getOutline()
  if (!outline?.length) return []
  let nextId = 0
  type OutlineNode = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number]

  async function pageOf(dest: OutlineNode['dest']): Promise<number | null> {
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      if (!Array.isArray(explicit) || explicit.length === 0) return null
      const target: unknown = explicit[0]
      if (typeof target === 'number') return target + 1
      if (target && typeof target === 'object') {
        return (await doc.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1
      }
    } catch {
      // Broken destination — keep the entry, just not clickable.
    }
    return null
  }

  async function map(nodes: OutlineNode[], level: number): Promise<PdfOutlineItem[]> {
    return Promise.all(
      nodes.map(async (node) => ({
        id: `pdf-outline-${nextId++}`,
        label: node.title?.trim() || 'Untitled',
        page: await pageOf(node.dest),
        level,
        children: node.items?.length ? await map(node.items as OutlineNode[], level + 1) : [],
      })),
    )
  }

  return map(outline, 0)
}

export function PdfRenderer({
  data,
  zoom,
  getScrollRoot,
  initialPage = 1,
  interactionTool = 'select',
  onHandPanBy,
  onCenterTap,
  onSelectionContextMenu,
  annotations,
  focusedAnnotationId = null,
  onAnnotationClick,
  onAnnotationHover,
  onAnnotationContextMenu,
  onBlankClick,
  onMarkupSelection,
  onInsertPoint,
  hiddenEmbeddedAnnotationIds,
  pagesPerView = 1,
  flow = 'scroll',
  apiRef,
  onNavState,
  onOutline,
  inkStrokes,
  selectedInkId = null,
  inkPen,
  onInkStroke,
  onInkSelect,
  onInkMove,
  onInkResize,
  renderInkToolbar,
  graphics,
  selectedGraphicId = null,
  onGraphicSelect,
  onGraphicResize,
  renderGraphicToolbar,
  shapes,
  selectedShapeId = null,
  onShapeSelect,
  shapePen,
  onShapeCreate,
  typewriters,
  typewriterEditing = false,
  onTypewriterBegin,
  onTypewriterOutside,
  renderTypewriterEditor,
  selectedTypewriterId = null,
  editingTypewriterId = null,
  onTypewriterSelect,
  onTypewriterBox,
  onTypewriterEdit,
  onTypewriterDelete,
  onTypewriterProperties,
  onShapeResize,
  renderShapeToolbar,
  onInkErase,
  eraserMode = 'stroke',
  onInkPartialErase,
}: PdfRendererProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  const rootRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<PointerGesture | null>(null)
  const dwellRef = useRef<HandHoverDwell | null>(null)
  const hand = interactionTool === 'hand'
  const handRef = useRef(hand)
  handRef.current = hand
  const onHandPanByRef = useRef(onHandPanBy)
  onHandPanByRef.current = onHandPanBy
  const onCenterTapRef = useRef(onCenterTap)
  onCenterTapRef.current = onCenterTap
  const onSelectionContextMenuRef = useRef(onSelectionContextMenu)
  onSelectionContextMenuRef.current = onSelectionContextMenu
  const pen = interactionTool === 'pen'
  const penRef = useRef(pen)
  penRef.current = pen
  const inkStrokesRef = useRef(inkStrokes)
  inkStrokesRef.current = inkStrokes
  const onInkStrokeRef = useRef(onInkStroke)
  onInkStrokeRef.current = onInkStroke
  const onInkSelectRef = useRef(onInkSelect)
  onInkSelectRef.current = onInkSelect
  /** The pen press in progress: the page it started on, its points so far (normalized, that page's box). */
  const inkDraftRef = useRef<{ pointerId: number; pageIndex: number; points: InkPoint[] } | null>(null)
  const [inkDraft, setInkDraft] = useState<{ pageIndex: number; points: InkPoint[] } | null>(null)
  const inkFrameRef = useRef<number | null>(null)
  const onInkMoveRef = useRef(onInkMove)
  onInkMoveRef.current = onInkMove
  const selectedInkIdRef = useRef(selectedInkId)
  selectedInkIdRef.current = selectedInkId
  /** The Hand drag of the selected stroke in progress; `dx` / `dy` are the (clamped) shift so far, page units. */
  const inkMoveRef = useRef<{ pointerId: number; id: string; pageIndex: number; startX: number; startY: number; dx: number; dy: number; moved: boolean } | null>(null)
  const [inkMove, setInkMove] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const inkMoveFrameRef = useRef<number | null>(null)
  const [erasePreview, setErasePreview] = useState<ReadonlyMap<string, InkPoint[][]> | null>(null)
  const onInkResizeRef = useRef(onInkResize)
  onInkResizeRef.current = onInkResize
  /** The handle drag in progress: `offset` = pointer minus the handle's centre at press time, `paths` = the preview. */
  const inkResizeRef = useRef<{
    pointerId: number
    kind: 'ink' | 'graphic' | 'shape'
    id: string
    pageIndex: number
    handle: string
    offset: InkPoint
    paths: InkPoint[][] | null
    box: PdfGraphicBox | null
    geometry: PdfShapeGeometryResult | null
  } | null>(null)
  const [inkResize, setInkResize] = useState<{ id: string; paths: InkPoint[][] } | null>(null)
  const graphicsRef = useRef(graphics)
  graphicsRef.current = graphics
  const selectedGraphicIdRef = useRef(selectedGraphicId)
  selectedGraphicIdRef.current = selectedGraphicId
  const onGraphicSelectRef = useRef(onGraphicSelect)
  onGraphicSelectRef.current = onGraphicSelect
  const onGraphicResizeRef = useRef(onGraphicResize)
  onGraphicResizeRef.current = onGraphicResize
  /** Preview of a file object's box during a handle drag (the file changes on release). */
  const [graphicResize, setGraphicResize] = useState<{ id: string; box: PdfGraphicBox } | null>(null)
  const [graphicHoverId, setGraphicHoverId] = useState<string | null>(null)
  const shapesRef = useRef(shapes)
  shapesRef.current = shapes
  const selectedShapeIdRef = useRef(selectedShapeId)
  selectedShapeIdRef.current = selectedShapeId
  const onShapeSelectRef = useRef(onShapeSelect)
  onShapeSelectRef.current = onShapeSelect
  const onShapeResizeRef = useRef(onShapeResize)
  onShapeResizeRef.current = onShapeResize
  const onShapeCreateRef = useRef(onShapeCreate)
  onShapeCreateRef.current = onShapeCreate
  const shapePenRef = useRef(shapePen)
  shapePenRef.current = shapePen
  /** Preview of a shape's geometry during a handle drag (the row changes on release). */
  const [shapeResize, setShapeResize] = useState<{ id: string; geometry: PdfShapeGeometryResult } | null>(null)
  const [shapeHoverId, setShapeHoverId] = useState<string | null>(null)
  /** The Shape-tool press in progress: the page it started on and the two normalized points (never saved until release). */
  const shapeDraftRef = useRef<{ pointerId: number; pageIndex: number; kind: PdfShapeKind; start: InkPoint; end: InkPoint } | null>(null)
  const [shapeDraft, setShapeDraft] = useState<PdfShapeDraft | null>(null)
  /** Stroke under the pointer (outline only — UI state, never saved) and the last idle pointer position. */
  const [inkHoverId, setInkHoverId] = useState<string | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const inkByPage = useMemo(() => {
    const byPage = new Map<number, PdfInkLayerMark[]>()
    for (const stroke of inkStrokes ?? []) {
      // The stroke being dragged is painted at its preview position (the saved one moves on release).
      let mark = inkMove?.id === stroke.id ? { ...stroke, paths: translateInkPaths(stroke.paths, inkMove.dx, inkMove.dy).paths } : stroke
      if (inkResize?.id === stroke.id) mark = { ...mark, paths: inkResize.paths }
      // Partial Eraser preview: what would remain, over a faded ghost of the whole stroke.
      const cut = erasePreview?.get(stroke.id)
      if (cut) mark = { ...mark, paths: cut, erasedGhost: stroke.paths }
      const list = byPage.get(mark.pageIndex)
      if (list) list.push(mark)
      else byPage.set(mark.pageIndex, [mark])
    }
    return byPage
  }, [inkStrokes, inkMove, inkResize, erasePreview])
  const typewriterTool = interactionTool === 'typewriter'
  const typewriterToolRef = useRef(typewriterTool)
  typewriterToolRef.current = typewriterTool
  const selectToolRef = useRef(interactionTool === 'select')
  selectToolRef.current = interactionTool === 'select'
  const onTypewriterSelectRef = useRef(onTypewriterSelect)
  onTypewriterSelectRef.current = onTypewriterSelect
  const [typewriterHoverId, setTypewriterHoverId] = useState<string | null>(null)
  const typewriterEditingRef = useRef(typewriterEditing)
  typewriterEditingRef.current = typewriterEditing
  const onTypewriterBeginRef = useRef(onTypewriterBegin)
  onTypewriterBeginRef.current = onTypewriterBegin
  const onTypewriterOutsideRef = useRef(onTypewriterOutside)
  onTypewriterOutsideRef.current = onTypewriterOutside
  /** The Typewriter press in progress: where it started on which page, and where the pointer is now. */
  const typewriterDragRef = useRef<{ pointerId: number; pageIndex: number; start: InkPoint; end: InkPoint; startClient: [number, number] } | null>(null)
  const [typewriterRubber, setTypewriterRubber] = useState<{ pageIndex: number; start: InkPoint; end: InkPoint } | null>(null)
  const typewritersByPageRef = useRef(new Map<number, PdfTypewriterMark[]>())
  const typewritersByPage = useMemo(() => {
    const byPage = new Map<number, PdfTypewriterMark[]>()
    for (const mark of typewriters ?? []) {
      const list = byPage.get(mark.pageIndex)
      if (list) list.push(mark)
      else byPage.set(mark.pageIndex, [mark])
    }
    typewritersByPageRef.current = byPage
    return byPage
  }, [typewriters])
  const shapeTool = interactionTool === 'shape'
  const shapeToolRef = useRef(shapeTool)
  shapeToolRef.current = shapeTool
  /** Shapes grouped by page; the one being resized is painted at its preview geometry. */
  const shapesByPage = useMemo(() => {
    const byPage = new Map<number, PdfShapeMark[]>()
    for (const mark of shapes ?? []) {
      const shown = shapeResize?.id === mark.id ? { ...mark, rect: shapeResize.geometry.rect, shape: shapeResize.geometry.shape } : mark
      const list = byPage.get(shown.pageIndex)
      if (list) list.push(shown)
      else byPage.set(shown.pageIndex, [shown])
    }
    return byPage
  }, [shapes, shapeResize])
  const eraser = interactionTool === 'eraser'
  const eraserRef = useRef(eraser)
  eraserRef.current = eraser
  const onInkEraseRef = useRef(onInkErase)
  onInkEraseRef.current = onInkErase
  /** The Eraser press in progress: where the last sweep step ended and every stroke touched so far (preview only until release). */
  const eraseRef = useRef<{
    pointerId: number
    last: { pageIndex: number; point: InkPoint } | null
    ids: Set<string>
    /** Partial mode: every sweep of the gesture per page, and what each touched stroke would be cut to. */
    sweeps: Map<number, InkEraseSweep[]>
    preview: Map<string, InkPoint[][]>
  } | null>(null)
  const [erasingIds, setErasingIds] = useState<ReadonlySet<string> | null>(null)
  const eraserModeRef = useRef(eraserMode)
  eraserModeRef.current = eraserMode
  const onInkPartialEraseRef = useRef(onInkPartialErase)
  onInkPartialEraseRef.current = onInkPartialErase
  const markupTool = markupToolOf(interactionTool)
  const markupToolRef = useRef(markupTool)
  markupToolRef.current = markupTool
  /** Hover / selection chrome exists only in Hand and Select: never under a pen, the eraser or a text-markup tool. */
  const outlinesOn = inkOutlinesAvailable({ pen: pen || shapeTool || typewriterTool, eraser, markup: markupTool != null })
  const outlinesOnRef = useRef(outlinesOn)
  outlinesOnRef.current = outlinesOn
  const onMarkupSelectionRef = useRef(onMarkupSelection)
  onMarkupSelectionRef.current = onMarkupSelection
  const onInsertPointRef = useRef(onInsertPoint)
  onInsertPointRef.current = onInsertPoint
  const onAnnotationClickRef = useRef(onAnnotationClick)
  onAnnotationClickRef.current = onAnnotationClick
  const onAnnotationHoverRef = useRef(onAnnotationHover)
  onAnnotationHoverRef.current = onAnnotationHover
  const hoveredAnnotationIdRef = useRef<string | null>(null)
  const reportAnnotationHover = (hit: PdfAnnotationHit | null) => {
    const id = hit?.id ?? null
    if (id === hoveredAnnotationIdRef.current) return
    hoveredAnnotationIdRef.current = id
    onAnnotationHoverRef.current?.(hit)
  }
  const onTypewriterPropertiesRef = useRef(onTypewriterProperties)
  onTypewriterPropertiesRef.current = onTypewriterProperties
  const onAnnotationContextMenuRef = useRef(onAnnotationContextMenu)
  onAnnotationContextMenuRef.current = onAnnotationContextMenu
  const onBlankClickRef = useRef(onBlankClick)
  onBlankClickRef.current = onBlankClick
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations

  /** Marks per 1-based page (a mark spanning pages is listed on each). */
  const marksByPage = useMemo(() => {
    const byPage = new Map<number, PdfAnnotationMark[]>()
    for (const mark of annotations ?? []) {
      for (const page of new Set(mark.rects.map((r) => r.page))) {
        const list = byPage.get(page)
        if (list) list.push(mark)
        else byPage.set(page, [mark])
      }
    }
    return byPage
  }, [annotations])
  const [flash, setFlash] = useState<PdfAnnotationFlash | null>(null)

  const slotsRef = useRef<(HTMLDivElement | null)[]>([])
  const renderedRef = useRef(new Map<number, RenderEntry>())
  /** 0-based page being read. */
  const currentRef = useRef(0)
  /** Page a navigation just scrolled to: it stays "current" while still on screen (end of doc). */
  const lockRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const restoredRef = useRef(false)
  /** Kept across a page-size refresh so the reader doesn't jump. */
  const anchorRef = useRef<{ index: number; fraction: number } | null>(null)
  /** Search hits to paint (null = none) and the hit last jumped to. */
  const searchMatcherRef = useRef<TextMatcher | null>(null)
  const searchHitRef = useRef<PdfSearchTarget | null>(null)
  const searchFrameRef = useRef<number | null>(null)
  /** Jumps waiting for a page's text layer, by page index. */
  const textWaitersRef = useRef(new Map<number, Array<() => void>>())

  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const getScrollRootRef = useRef(getScrollRoot)
  getScrollRootRef.current = getScrollRoot
  const onNavStateRef = useRef(onNavState)
  onNavStateRef.current = onNavState
  const onOutlineRef = useRef(onOutline)
  onOutlineRef.current = onOutline
  const initialPageRef = useRef(initialPage)
  const docRef = useRef(doc)
  docRef.current = doc
  const pageCountRef = useRef(0)
  pageCountRef.current = sizes.length

  const paged = flow === 'paged'
  const pagedRef = useRef(paged)
  pagedRef.current = paged
  const perViewRef = useRef(pagesPerView)
  perViewRef.current = pagesPerView
  /** Paged flow: index of the spread (row of `pagesPerView` pages) on screen. */
  const [spread, setSpread] = useState(0)
  const spreadRef = useRef(0)
  /** The spread being turned away from (still shown for the length of the animation). */
  const [leaving, setLeaving] = useState<number | null>(null)
  const rowsRef = useRef<(HTMLDivElement | null)[]>([])
  const turnRef = useRef<{ from: number; to: number } | null>(null)
  const animRef = useRef<Animation | null>(null)
  const finishedAnimRef = useRef<Animation | null>(null)

  const cssScale = PDF_TO_CSS * zoom
  const gap = Math.round(PAGE_GAP_PX * zoom)
  const pad = Math.round(PAD_PX * zoom)

  const reportCurrent = useCallback((index: number) => {
    currentRef.current = index
    onNavStateRef.current?.({ pageCurrent: index + 1, pageTotal: pageCountRef.current })
  }, [])

  /**
   * Paged flow: show spread `target` (clamped). `animate` plays the page-turn from the spread on
   * screen; `page` (0-based) is what to report as current (default: the spread's first page).
   */
  const goToSpread = useCallback(
    (target: number, animate = true, page?: number) => {
      const per = perViewRef.current
      const count = Math.max(1, Math.ceil(pageCountRef.current / per))
      const next = Math.min(Math.max(target, 0), count - 1)
      const from = spreadRef.current
      reportCurrent(page ?? next * per)
      if (next === from) return
      animRef.current?.cancel()
      animRef.current = null
      spreadRef.current = next
      turnRef.current = animate ? { from, to: next } : null
      setLeaving(animate ? from : null)
      setSpread(next)
    },
    [reportCurrent],
  )

  /**
   * Repaint search hits over every page that currently has a text layer. Returns the current hit's
   * Range (if its page is rendered) so a jump can scroll it into view.
   */
  const repaintSearch = useCallback((): Range | null => {
    searchFrameRef.current = null
    const matcher = searchMatcherRef.current
    if (!matcher) {
      clearPdfSearchHighlights(document)
      return null
    }
    const hit = searchHitRef.current
    const ranges: Range[] = []
    let current: Range | null = null
    const pages = [...renderedRef.current.entries()].sort((a, b) => a[0] - b[0])
    for (const [index, entry] of pages) {
      if (!entry.text) continue
      ranges.push(...pdfPageSearchRanges(entry.text, matcher))
      if (hit && hit.pageIndex === index) {
        const textIndex = buildPdfTextLayerIndex(entry.text)
        const match = pickSectionMatch(matcher.find(textIndex.text), hit.occurrence, hit.count)
        current = match ? rangeForMatch(document, textIndex, match) : null
      }
    }
    paintPdfSearchHighlights(document, ranges, current)
    return current
  }, [])

  const scheduleSearchRepaint = useCallback(() => {
    if (searchFrameRef.current !== null || !searchMatcherRef.current) return
    searchFrameRef.current = requestAnimationFrame(() => {
      repaintSearch()
    })
  }, [repaintSearch])

  const notifyTextLayer = useCallback(
    (index: number) => {
      const waiters = textWaitersRef.current.get(index)
      if (waiters) {
        textWaitersRef.current.delete(index)
        for (const resolve of waiters) resolve()
      }
      scheduleSearchRepaint()
    },
    [scheduleSearchRepaint],
  )

  /** Resolves once page `index` has an up-to-date text layer (or after a timeout). */
  const waitForTextLayer = useCallback((index: number): Promise<void> => {
    const entry = renderedRef.current.get(index)
    if (entry?.text && entry.scale === PDF_TO_CSS * zoomRef.current) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, TEXT_LAYER_WAIT_MS)
      const list = textWaitersRef.current.get(index) ?? []
      list.push(() => {
        window.clearTimeout(timer)
        resolve()
      })
      textWaitersRef.current.set(index, list)
    })
  }, [])

  const release = useCallback((index: number) => {
    const entry = renderedRef.current.get(index)
    if (!entry) return
    renderedRef.current.delete(index)
    entry.task?.cancel()
    entry.textLayer?.cancel()
    if (entry.canvas) {
      // Drop the backing store right away instead of waiting for GC.
      entry.canvas.width = 0
      entry.canvas.height = 0
      entry.canvas.remove()
    }
    detachTextLayerSelection(entry.text)
    entry.text?.remove()
    entry.page?.cleanup()
    scheduleSearchRepaint()
  }, [scheduleSearchRepaint])

  const ensureRendered = useCallback((index: number, scale: number) => {
    const pdf = docRef.current
    if (!pdf) return
    const previous = renderedRef.current.get(index)
    if (previous && previous.scale === scale) return
    previous?.task?.cancel()
    previous?.textLayer?.cancel()
    // The previous canvas / text stay on screen (stretched to the new slot size) until replaced.
    const entry: RenderEntry = {
      scale,
      page: previous?.page ?? null,
      task: null,
      textLayer: null,
      canvas: previous?.canvas ?? null,
      text: previous?.text ?? null,
    }
    renderedRef.current.set(index, entry)
    const stale = () => renderedRef.current.get(index) !== entry

    void (async () => {
      const page = entry.page ?? (await pdf.getPage(index + 1))
      entry.page = page
      if (stale()) return
      const slot = slotsRef.current[index]
      if (!slot) return
      const viewport = page.getViewport({ scale })

      const canvas = document.createElement('canvas')
      const area = viewport.width * viewport.height
      let ratio = window.devicePixelRatio || 1
      if (area * ratio * ratio > MAX_CANVAS_PIXELS) ratio = Math.sqrt(MAX_CANVAS_PIXELS / area)
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.className = 'pointer-events-none absolute inset-0 block h-full w-full'
      entry.task = page.render({
        canvas,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        // Honors the `noView` entries `hiddenEmbeddedAnnotationIds` puts in the document's storage;
        // with none there it draws exactly like the default mode.
        annotationMode: AnnotationMode.ENABLE_STORAGE,
      })
      await entry.task.promise
      if (stale()) {
        canvas.width = 0
        canvas.height = 0
        return
      }
      if (entry.canvas) {
        entry.canvas.width = 0
        entry.canvas.height = 0
        entry.canvas.remove()
      }
      slot.prepend(canvas)
      entry.canvas = canvas

      const text = document.createElement('div')
      text.className = 'textLayer'
      const userUnit = viewport.userUnit ?? 1
      text.style.setProperty('--scale-factor', String(viewport.scale))
      text.style.setProperty('--user-unit', String(userUnit))
      // The text layer sizes its spans (and itself) from `--total-scale-factor`, which
      // pdf_viewer.css only defines under `.pdfViewer .page` — not used here. Without it the
      // invisible text drifts off the canvas, so a selection doesn't land on the visible words.
      text.style.setProperty('--total-scale-factor', String(viewport.scale * userUnit))
      entry.textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: text,
        viewport,
      })
      await entry.textLayer.render()
      if (stale()) return
      // pdf.js viewer's `.endOfContent` trick: dragging through gaps no longer jumps to the end.
      attachTextLayerSelection(text)
      detachTextLayerSelection(entry.text)
      entry.text?.remove()
      slot.append(text)
      entry.text = text
      notifyTextLayer(index)
    })().catch((err: unknown) => {
      if (isCancelled(err)) return
      console.warn('[PdfRenderer] page render failed', index + 1, err)
    })
  }, [notifyTextLayer])

  /** Visible range + current page from the scroll container's geometry, then render / release. */
  const updateView = useCallback(() => {
    frameRef.current = null
    const root = getScrollRootRef.current()
    const slots = slotsRef.current
    const count = pageCountRef.current
    if (!root || !docRef.current || count === 0) return

    if (pagedRef.current) {
      // Only the spread on screen (and the turn's other side) matters; its neighbours are warmed.
      const per = perViewRef.current
      const shown = spreadRef.current * per
      const lo = Math.max(0, shown - per)
      const hi = Math.min(count - 1, shown + 2 * per - 1)
      const scale = PDF_TO_CSS * zoomRef.current
      for (let i = lo; i <= hi; i++) ensureRendered(i, scale)
      for (const index of [...renderedRef.current.keys()]) {
        if (index < lo - per || index > hi + per) release(index)
      }
      return
    }
    const rootRect = root.getBoundingClientRect()
    const top = rootRect.top
    const bottom = rootRect.top + root.clientHeight

    // First slot whose bottom edge is below the viewport top (slots are in document order).
    let lo = 0
    let hi = count - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const el = slots[mid]
      if (el && el.getBoundingClientRect().bottom <= top) lo = mid + 1
      else hi = mid
    }
    const first = lo
    let last = first
    let best = first
    let bestVisible = -1
    for (let i = first; i < count; i++) {
      const el = slots[i]
      if (!el) break
      const rect = el.getBoundingClientRect()
      if (rect.top >= bottom && i > first) break
      last = i
      const visible = Math.min(rect.bottom, bottom) - Math.max(rect.top, top)
      // Strictly greater: with several fully visible pages the first one is "current".
      if (visible > bestVisible + 0.5) {
        bestVisible = visible
        best = i
      }
    }

    const lock = lockRef.current
    if (lock !== null && lock >= first && lock <= last) best = lock
    else lockRef.current = null
    if (best !== currentRef.current) reportCurrent(best)

    const scale = PDF_TO_CSS * zoomRef.current
    for (let i = Math.max(0, first - RENDER_AHEAD); i <= Math.min(count - 1, last + RENDER_AHEAD); i++) {
      ensureRendered(i, scale)
    }
    for (const index of [...renderedRef.current.keys()]) {
      if (index < first - KEEP_AROUND || index > last + KEEP_AROUND) release(index)
    }
  }, [ensureRendered, release, reportCurrent])

  const scheduleUpdate = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(updateView)
  }, [updateView])

  /** Ids already set `noView` in the current document's storage (reset per document). */
  const hiddenAppliedRef = useRef<{ doc: PDFDocumentProxy | null; ids: Set<string> }>({ doc: null, ids: new Set() })

  // Stop drawing the file's own appearance of embedded annotations the app paints (or that the user
  // deleted in the app). Only the document in memory changes — never the file. Rendered pages are
  // re-rendered; their old canvas stays up until the new one replaces it.
  useEffect(() => {
    if (!doc || !hiddenEmbeddedAnnotationIds?.length) return
    const applied = hiddenAppliedRef.current
    if (applied.doc !== doc) hiddenAppliedRef.current = { doc, ids: new Set() }
    const ids = hiddenAppliedRef.current.ids
    let added = false
    for (const id of hiddenEmbeddedAnnotationIds) {
      if (ids.has(id)) continue
      ids.add(id)
      doc.annotationStorage.setValue(id, { noView: true })
      added = true
    }
    if (!added) return
    for (const entry of renderedRef.current.values()) entry.scale = -1
    scheduleUpdate()
  }, [doc, hiddenEmbeddedAnnotationIds, scheduleUpdate])

  const scrollToIndex = useCallback(
    (index: number) => {
      const root = getScrollRootRef.current()
      const count = pageCountRef.current
      if (!root || count === 0) return
      const target = Math.min(Math.max(index, 0), count - 1)
      if (pagedRef.current) {
        goToSpread(Math.floor(target / perViewRef.current), true, target)
        scheduleUpdate()
        return
      }
      const slot = slotsRef.current[target]
      if (!slot) return
      const offset = slot.getBoundingClientRect().top - root.getBoundingClientRect().top
      root.scrollTop += offset - Math.round(PAGE_GAP_PX * zoomRef.current)
      lockRef.current = target
      reportCurrent(target)
      scheduleUpdate()
    },
    [goToSpread, reportCurrent, scheduleUpdate],
  )

  /** Next / previous spread (row of `pagesPerView` pages), turned in paged flow, scrolled to otherwise. */
  const stepSpread = useCallback(
    (direction: 1 | -1) => {
      const per = perViewRef.current
      scrollToIndex((Math.floor(currentRef.current / per) + direction) * per)
    },
    [scrollToIndex],
  )

  /** Serialises thumbnail renders so a scrolled Page layout grid never floods PDF.js. */
  const thumbQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  const renderThumbnail = useCallback(
    (pageNumber: number, cssWidth: number, signal: AbortSignal): Promise<HTMLCanvasElement | null> => {
      const run = async (): Promise<HTMLCanvasElement | null> => {
        const pdf = docRef.current
        if (signal.aborted || !pdf || pageNumber < 1 || pageNumber > pdf.numPages || cssWidth <= 0) return null
        const page = await pdf.getPage(pageNumber)
        if (signal.aborted) return null
        const base = page.getViewport({ scale: 1 })
        const ratio = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: (cssWidth * ratio) / base.width })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.floor(viewport.width))
        canvas.height = Math.max(1, Math.floor(viewport.height))
        const task = page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE_STORAGE })
        const cancel = () => task.cancel()
        signal.addEventListener('abort', cancel, { once: true })
        try {
          await task.promise
        } catch (err) {
          canvas.width = 0
          canvas.height = 0
          if (isCancelled(err)) return null
          throw err
        } finally {
          signal.removeEventListener('abort', cancel)
        }
        return signal.aborted ? null : canvas
      }
      const result = thumbQueueRef.current.then(run, run)
      thumbQueueRef.current = result.catch(() => null)
      return result
    },
    [],
  )

  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      renderThumbnail,
      measurePage: async (pageNumber) => {
        const pdf = docRef.current
        if (!pdf || pageNumber < 1 || pageNumber > pdf.numPages) return null
        const viewport = (await pdf.getPage(pageNumber)).getViewport({ scale: 1 })
        return { width: viewport.width * PDF_TO_CSS, height: viewport.height * PDF_TO_CSS }
      },
      goToPage: (page) => scrollToIndex(page - 1),
      goToPagePoint: (page, y) => {
        scrollToIndex(page - 1)
        if (y === undefined) return
        const shiftToPoint = () => {
          const root = getScrollRootRef.current()
          const slot = slotsRef.current[page - 1]
          if (!root || !slot) return
          // The page top is now at the top of the view; bring a point lower down to the upper third
          // (a point already in the upper third keeps the page top visible).
          const rect = slot.getBoundingClientRect()
          const shift = rect.top + y * rect.height - root.getBoundingClientRect().top - root.clientHeight / 3
          if (shift > 0) root.scrollTop += shift
        }
        // Paged flow shows the target spread on the next render, so measure after it.
        if (pagedRef.current) requestAnimationFrame(shiftToPoint)
        else shiftToPoint()
      },
      flashAnnotation: (id) => setFlash({ id, nonce: Date.now() }),
      nextPage: () => stepSpread(1),
      prevPage: () => stepSpread(-1),
      getNavState: () => ({ pageCurrent: currentRef.current + 1, pageTotal: pageCountRef.current }),
      getCurrentLocation: () =>
        pageCountRef.current > 0 ? new PageRectLocation(currentRef.current + 1) : undefined,
      setSearchHighlights: (matcher) => {
        searchMatcherRef.current = matcher
        if (!matcher) searchHitRef.current = null
        repaintSearch()
      },
      goToSearchMatch: async (target) => {
        searchHitRef.current = target
        scrollToIndex(target.pageIndex)
        await waitForTextLayer(target.pageIndex)
        // A newer jump (rapid Next) or a cleared search took over meanwhile.
        if (searchHitRef.current !== target) return
        const current = repaintSearch()
        const root = getScrollRootRef.current()
        if (!current || !root) return
        const rect = current.getBoundingClientRect()
        const rootRect = root.getBoundingClientRect()
        // Bring the hit to the upper third unless it is already comfortably on screen.
        if (rect.top < rootRect.top || rect.bottom > rootRect.top + root.clientHeight) {
          root.scrollTop += rect.top - rootRect.top - root.clientHeight / 3
        }
      },
      clearSelection: () => {
        const selection = window.getSelection()
        const pages = rootRef.current
        if (!selection || selection.isCollapsed || !pages?.contains(selection.anchorNode)) return false
        selection.removeAllRanges()
        return true
      },
    }
    return () => {
      apiRef.current = null
    }
  }, [apiRef, scrollToIndex, stepSpread, repaintSearch, waitForTextLayer, renderThumbnail])

  // Open the document. PDF.js transfers the buffer to its worker, so hand it a copy and keep the
  // caller's ArrayBuffer intact.
  useEffect(() => {
    setStatus({ kind: 'loading' })
    setDoc(null)
    setSizes([])
    // Same book re-read after an edit written into the file: come back to the page being read.
    if (restoredRef.current) initialPageRef.current = currentRef.current + 1
    restoredRef.current = false
    const task = getDocument({ data: new Uint8Array(data.slice(0)) })
    let cancelled = false
    const rendered = renderedRef.current
    const textWaiters = textWaitersRef.current

    void (async () => {
      try {
        const pdf = await task.promise
        if (cancelled) return
        const first = (await pdf.getPage(1)).getViewport({ scale: 1 })
        if (cancelled) return
        const base: PageSize = first.width > 0 ? { w: first.width, h: first.height } : FALLBACK_SIZE
        setSizes(Array.from({ length: pdf.numPages }, () => base))
        setDoc(pdf)
        setStatus({ kind: 'ready' })

        resolveOutline(pdf).then(
          (items) => {
            if (!cancelled) onOutlineRef.current?.(items)
          },
          () => {
            if (!cancelled) onOutlineRef.current?.([])
          },
        )

        // Measure every page in the background so mixed-size documents lay out exactly. One state
        // update at the end; the reading position is anchored across it.
        const measured: PageSize[] = []
        let differs = false
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return
          const vp = (await pdf.getPage(i)).getViewport({ scale: 1 })
          const size = { w: vp.width, h: vp.height }
          measured.push(size)
          if (Math.abs(size.w - base.w) > 0.5 || Math.abs(size.h - base.h) > 0.5) differs = true
          // Yield now and then so a 1000-page file doesn't hog the main thread.
          if (i % 50 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
        }
        if (cancelled || !differs) return
        const root = getScrollRootRef.current()
        const slot = slotsRef.current[currentRef.current]
        if (root && slot) {
          const rect = slot.getBoundingClientRect()
          const rootTop = root.getBoundingClientRect().top
          anchorRef.current = {
            index: currentRef.current,
            fraction: rect.height > 0 ? (rootTop - rect.top) / rect.height : 0,
          }
        }
        setSizes(measured)
      } catch (err) {
        if (cancelled || isCancelled(err)) return
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not open this PDF.' })
      }
    })()

    return () => {
      cancelled = true
      for (const index of [...rendered.keys()]) {
        const entry = rendered.get(index)
        rendered.delete(index)
        entry?.task?.cancel()
        entry?.textLayer?.cancel()
        detachTextLayerSelection(entry?.text)
        if (entry?.canvas) {
          entry.canvas.width = 0
          entry.canvas.height = 0
        }
      }
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      if (searchFrameRef.current !== null) cancelAnimationFrame(searchFrameRef.current)
      searchFrameRef.current = null
      textWaiters.clear()
      clearPdfSearchHighlights(document)
      // Destroys the document and terminates its worker-side state.
      void task.destroy()
    }
  }, [data])

  // First layout: jump to the saved page, then keep the reader's place across size refreshes.
  useLayoutEffect(() => {
    if (!doc || sizes.length === 0) return
    if (!restoredRef.current) {
      restoredRef.current = true
      const start = Math.min(Math.max(initialPageRef.current, 1), sizes.length) - 1
      if (pagedRef.current) goToSpread(Math.floor(start / perViewRef.current), false, start)
      else if (start > 0) scrollToIndex(start)
      else reportCurrent(0)
      return
    }
    if (pagedRef.current) return
    const anchor = anchorRef.current
    anchorRef.current = null
    const root = getScrollRootRef.current()
    const slot = anchor ? slotsRef.current[anchor.index] : null
    if (anchor && root && slot) {
      const rect = slot.getBoundingClientRect()
      root.scrollTop += rect.top + anchor.fraction * rect.height - root.getBoundingClientRect().top
    }
  }, [doc, sizes, reportCurrent, scrollToIndex, goToSpread])

  // Scroll / resize of the container, zoom and layout changes → recompute what's on screen.
  useEffect(() => {
    if (!doc) return
    const root = getScrollRootRef.current()
    if (!root) return
    root.addEventListener('scroll', scheduleUpdate, { passive: true })
    const resize = new ResizeObserver(scheduleUpdate)
    resize.observe(root)
    return () => {
      root.removeEventListener('scroll', scheduleUpdate)
      resize.disconnect()
    }
  }, [doc, scheduleUpdate])

  useEffect(() => {
    scheduleUpdate()
  }, [zoom, sizes, spread, leaving, paged, pagesPerView, scheduleUpdate])

  // Switching flow or pages-per-view keeps the page being read.
  const layoutModeRef = useRef({ paged, pagesPerView })
  useLayoutEffect(() => {
    const previous = layoutModeRef.current
    if (previous.paged === paged && previous.pagesPerView === pagesPerView) return
    layoutModeRef.current = { paged, pagesPerView }
    // The page slots were rebuilt under new parents (rows / grid), so every canvas and text layer
    // sits in a detached slot: drop them and let the next update render into the new ones.
    for (const index of [...renderedRef.current.keys()]) release(index)
    if (!restoredRef.current) return
    animRef.current?.cancel()
    animRef.current = null
    turnRef.current = null
    setLeaving(null)
    const page = currentRef.current
    spreadRef.current = Math.floor(page / pagesPerView)
    setSpread(spreadRef.current)
    if (!paged) scrollToIndex(page)
  }, [paged, pagesPerView, scrollToIndex, release])

  // Paged flow: a new spread starts at the top of the view, and the page-turn plays on the row
  // that moves — the outgoing one when going forward, the incoming one when going back.
  useLayoutEffect(() => {
    const turn = turnRef.current
    turnRef.current = null
    if (!pagedRef.current) return
    const root = getScrollRootRef.current()
    if (root) root.scrollTop = 0
    if (!turn) return
    const forward = turn.to > turn.from
    const row = rowsRef.current[forward ? turn.from : turn.to]
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!row || reduced || typeof row.animate !== 'function') {
      setLeaving(null)
      return
    }
    const shadow = '0 0 48px rgba(0, 0, 0, 0.45)'
    const animation = row.animate(
      [
        { transform: 'rotateY(0deg)', opacity: 1, boxShadow: '0 0 0 rgba(0, 0, 0, 0)', zIndex: 2 },
        { offset: 0.8, transform: 'rotateY(-80deg)', opacity: 1, boxShadow: shadow, zIndex: 2 },
        { transform: 'rotateY(-100deg)', opacity: 0, boxShadow: shadow, zIndex: 2 },
      ],
      { duration: PAGE_TURN_MS, easing: 'ease-in-out', fill: 'forwards', direction: forward ? 'normal' : 'reverse' },
    )
    animRef.current = animation
    animation.onfinish = () => {
      if (animRef.current !== animation) return
      animRef.current = null
      finishedAnimRef.current = animation
      setLeaving(null)
    }
  }, [spread])

  // The turned-away row is hidden by now: release its finished animation.
  useEffect(() => {
    if (leaving !== null) return
    finishedAnimRef.current?.cancel()
    finishedAnimRef.current = null
  }, [leaving])

  useEffect(
    () => () => {
      animRef.current?.cancel()
      finishedAnimRef.current?.cancel()
    },
    [],
  )

  const setSurfaceFlag = useCallback((flag: SurfaceFlag, on: boolean) => {
    rootRef.current?.toggleAttribute(flag, on)
  }, [])

  // Hand hover dwell (shared rules, `reader/interaction/hand-gesture.ts`): arms the I-beam over
  // text after HAND_HOVER_CURSOR_DELAY_MS — CSS `[data-pdf-hover-text]` in index.css.
  useEffect(() => {
    const dwell = createHandHoverDwell((armed) => setSurfaceFlag('data-pdf-hover-text', armed))
    dwellRef.current = dwell
    return () => {
      dwell.dispose()
      dwellRef.current = null
    }
  }, [setSurfaceFlag])

  // A jump's pulse ends on its own (a newer flash restarts the timer).
  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), ANNOTATION_FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])

  /**
   * The annotation under client (`x`, `y`): a note icon first (small, may sit past the page edge),
   * then the topmost mark rect on the page there. Marks never take pointer events themselves.
   */
  const annotationAt = (x: number, y: number): PdfAnnotationHit | null => {
    const marks = annotationsRef.current
    const root = rootRef.current
    if (!marks?.length || !root) return null
    const within = (r: DOMRect) =>
      x >= r.left - ANNOTATION_HIT_SLOP_PX &&
      x <= r.right + ANNOTATION_HIT_SLOP_PX &&
      y >= r.top - ANNOTATION_HIT_SLOP_PX &&
      y <= r.bottom + ANNOTATION_HIT_SLOP_PX
    for (const icon of root.querySelectorAll<HTMLElement>('[data-pdf-annot-note]')) {
      const rect = icon.getBoundingClientRect()
      if (icon.dataset.pdfAnnotId && within(rect)) return { id: icon.dataset.pdfAnnotId, rect }
    }
    const slot = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-page-number]')
    if (!slot || !root.contains(slot)) return null
    const box = slot.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return null
    const mark = pdfMarkAt(
      marks.filter((m) => m.styleKind !== 'textbox'),
      Number(slot.dataset.pageNumber),
      (x - box.left) / box.width,
      (y - box.top) / box.height,
      ANNOTATION_HIT_SLOP_PX / box.width,
      ANNOTATION_HIT_SLOP_PX / box.height,
    )
    if (!mark) return null
    // Anchor UI to the mark's boxes on this page (their union).
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const el of slot.querySelectorAll<HTMLElement>(`[data-pdf-annot-id="${CSS.escape(mark.id)}"]`)) {
      const r = el.getBoundingClientRect()
      left = Math.min(left, r.left)
      top = Math.min(top, r.top)
      right = Math.max(right, r.right)
      bottom = Math.max(bottom, r.bottom)
    }
    const rect = Number.isFinite(left) ? new DOMRect(left, top, right - left, bottom - top) : new DOMRect(x, y, 0, 0)
    return { id: mark.id, rect }
  }

  // While the PDF holds a text selection, keep its text selectable (CSS `[data-pdf-has-selection]`).
  // Hand only allows selection while the pointer rests on text; without this, moving off the text —
  // e.g. into the selection menu — turned `user-select` back to none, and Chromium stops painting
  // (and `toString()`-ing) a selection inside user-select:none content, so it looked lost.
  useEffect(() => {
    const update = () => {
      const selection = window.getSelection()
      const root = rootRef.current
      setSurfaceFlag(
        'data-pdf-has-selection',
        !!selection && !selection.isCollapsed && !!root?.contains(selection.anchorNode),
      )
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [setSurfaceFlag])

  /** PDF hit-test for the dwell: a glyph run of the text layer (no link layer is rendered). */
  const isTextAt = (clientX: number, clientY: number): boolean => {
    const span = document.elementFromPoint(clientX, clientY)?.closest('.textLayer span')
    return !!span && !!rootRef.current?.contains(span)
  }

  /** Forget the current press; a pan also gives the pointer back and drops the grabbing cursor. */
  const endGesture = useCallback((): PointerGesture | null => {
    const gesture = gestureRef.current
    gestureRef.current = null
    if (gesture?.pan) {
      const el = rootRef.current
      try {
        if (el?.hasPointerCapture(gesture.pointerId)) el.releasePointerCapture(gesture.pointerId)
      } catch {
        /* element already detached */
      }
    }
    setSurfaceFlag('data-pdf-grabbing', false)
    return gesture
  }, [setSurfaceFlag])

  // Switching Hand ↔ Select mid-press (or unmounting) ends that press and drops the I-beam.
  useEffect(
    () => () => {
      endGesture()
      dwellRef.current?.disarm()
    },
    [hand, endGesture],
  )

  // Window blur mid-drag (Alt+Tab): no pointerup will come — end the press, back to grab.
  useEffect(() => {
    const onBlur = () => {
      endGesture()
      dwellRef.current?.disarm()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [endGesture])

  /** The page slot (0-based index + box) under a client point, or null off the pages. */
  const slotAt = (x: number, y: number): { index: number; rect: DOMRect } | null => {
    const slots = slotsRef.current
    for (let index = 0; index < slots.length; index++) {
      const rect = slots[index]?.getBoundingClientRect()
      if (rect && rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return { index, rect }
      }
    }
    return null
  }

  /** `px` screen pixels in page-width units on a page `rect` wide (capture filter, hit slop). */
  const pagePx = (rect: DOMRect, px: number) => px / rect.width

  const beginInk = (event: ReactPointerEvent<HTMLDivElement>) => {
    const hit = slotAt(event.clientX, event.clientY)
    if (!hit) return
    const point = clientToPageUnit(event.clientX, event.clientY, hit.rect)
    if (!point) return
    // Not a text selection, not a page turn, not a pan: the press belongs to the pen.
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    selectTarget(null)
    onBlankClickRef.current?.()
    inkDraftRef.current = { pointerId: event.pointerId, pageIndex: hit.index, points: [point] }
    setInkDraft({ pageIndex: hit.index, points: [point] })
  }

  const moveInk = (event: ReactPointerEvent<HTMLDivElement>) => {
    const draft = inkDraftRef.current
    if (!draft || event.pointerId !== draft.pointerId) return
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
      finishInk()
      return
    }
    const rect = slotsRef.current[draft.pageIndex]?.getBoundingClientRect()
    if (!rect) return
    const native = event.nativeEvent
    // Every sample the device produced since the last event (a stylus reports far faster than frames).
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    const samples: PointerEvent[] = coalesced.length > 0 ? coalesced : [native]
    const minStep = pagePx(rect, 0.5)
    const ratio = rect.height / rect.width
    let added = false
    for (const sample of samples) {
      const point = clientToPageUnit(sample.clientX, sample.clientY, rect)
      const last = draft.points[draft.points.length - 1]
      if (!point || !last) continue
      if (Math.hypot(point[0] - last[0], (point[1] - last[1]) * ratio) < minStep) continue
      draft.points.push(point)
      added = true
    }
    if (added && inkFrameRef.current === null) {
      inkFrameRef.current = requestAnimationFrame(() => {
        inkFrameRef.current = null
        const current = inkDraftRef.current
        if (current) setInkDraft({ pageIndex: current.pageIndex, points: [...current.points] })
      })
    }
  }

  /** End the pen press and hand the stroke over (a press that produced a point always saves: a tap is a dot). */
  const finishInk = () => {
    const draft = inkDraftRef.current
    inkDraftRef.current = null
    if (inkFrameRef.current !== null) {
      cancelAnimationFrame(inkFrameRef.current)
      inkFrameRef.current = null
    }
    setInkDraft(null)
    if (!draft) return
    const el = rootRef.current
    try {
      if (el?.hasPointerCapture(draft.pointerId)) el.releasePointerCapture(draft.pointerId)
    } catch {
      /* element already detached */
    }
    const rect = slotsRef.current[draft.pageIndex]?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || draft.points.length === 0) return
    const ratio = rect.height / rect.width
    const points = simplifyInkPoints(filterMinDistance(draft.points, pagePx(rect, 0.5), ratio), pagePx(rect, 0.35), ratio)
    onInkStrokeRef.current?.(draft.pageIndex, points)
  }

  // Window blur / leaving the pen tool / unmounting mid-stroke: no pointerup will come, so keep what was drawn.
  useEffect(() => {
    const onBlur = () => {
      finishInk()
      endInkMove(false)
    }
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      finishInk()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finishInk only reads refs and stable setters
  }, [pen])

  /** The stroke under client (`x`, `y`), if any: the selected one wherever it is hit, else the topmost. */
  const inkAt = (x: number, y: number): PdfInkLayerMark | null => {
    const strokes = inkStrokesRef.current
    if (!strokes?.length) return null
    const hit = slotAt(x, y)
    const size = hit ? sizes[hit.index] : undefined
    if (!hit || !size) return null
    const point = clientToPageUnit(x, y, hit.rect)
    return point ? pickInkTarget(strokes, selectedInkIdRef.current, hit.index, point[0], point[1], size.h / size.w, pagePx(hit.rect, 6)) : null
  }

  /** The file object (made by another reader) under client (`x`, `y`): the selected one wherever it is hit, else the topmost. */
  const graphicAt = (x: number, y: number): PdfGraphicObject | null => {
    const objects = graphicsRef.current
    if (!objects?.length) return null
    const hit = slotAt(x, y)
    const size = hit ? sizes[hit.index] : undefined
    if (!hit || !size) return null
    const point = clientToPageUnit(x, y, hit.rect)
    return point ? pdfGraphicAt(objects, selectedGraphicIdRef.current, hit.index, point[0], point[1], size.h / size.w, pagePx(hit.rect, 6)) : null
  }

  /** The shape annotation under client (`x`, `y`): the selected one wherever it is hit, else the topmost (last in the list). */
  const shapeAt = (x: number, y: number): PdfShapeMark | null => {
    const list = shapesRef.current
    if (!list?.length) return null
    const hit = slotAt(x, y)
    const size = hit ? sizes[hit.index] : undefined
    if (!hit || !size) return null
    const point = clientToPageUnit(x, y, hit.rect)
    if (!point) return null
    const ratio = size.h / size.w
    const slop = pagePx(hit.rect, 6)
    const touches = (m: PdfShapeMark) => m.pageIndex === hit.index && pdfShapeHit(m.kind, m.rect, m.shape, point[0], point[1], ratio, slop)
    const selected = selectedShapeIdRef.current ? list.find((m) => m.id === selectedShapeIdRef.current) : undefined
    if (selected && touches(selected)) return selected
    for (let i = list.length - 1; i >= 0; i--) if (touches(list[i]!)) return list[i]!
    return null
  }

  /** What a pointer at client (`x`, `y`) refers to: Ink strokes first, then shape annotations, then the file's own objects. */
  const targetAt = (x: number, y: number): { kind: 'ink' | 'graphic' | 'shape'; id: string } | null => {
    const stroke = inkAt(x, y)
    if (stroke) return { kind: 'ink', id: stroke.id }
    const shape = shapeAt(x, y)
    if (shape) return { kind: 'shape', id: shape.id }
    const object = graphicAt(x, y)
    return object ? { kind: 'graphic', id: object.objectId } : null
  }

  /** Select what is under the pointer (or nothing): one selection across strokes, shapes and file objects. */
  const selectTarget = (target: { kind: 'ink' | 'graphic' | 'shape'; id: string } | null) => {
    onInkSelectRef.current?.(target?.kind === 'ink' ? target.id : null)
    onShapeSelectRef.current?.(target?.kind === 'shape' ? target.id : null)
    onGraphicSelectRef.current?.(target?.kind === 'graphic' ? target.id : null)
  }

  /** Hover feedback for what is under client (`x`, `y`): outline only, never selects or changes anything. */
  const updateInkHover = (x: number, y: number) => {
    const target = outlinesOnRef.current ? targetAt(x, y) : null
    const inkId = target?.kind === 'ink' ? target.id : null
    const graphicId = target?.kind === 'graphic' && target.id !== selectedGraphicIdRef.current ? target.id : null
    const shapeId = target?.kind === 'shape' ? target.id : null
    setInkHoverId((prev) => (prev === inkId ? prev : reduceInkInteraction({ hoverId: prev, selectedId: selectedInkIdRef.current }, { type: 'hover', id: inkId }).hoverId))
    setGraphicHoverId((prev) => (prev === graphicId ? prev : graphicId))
    setShapeHoverId((prev) => (prev === shapeId ? prev : shapeId))
  }

  /** Re-run the hover hit test at the last idle pointer position (after a scroll, zoom, page change or stroke edit). */
  const refreshInkHover = () => {
    const last = lastPointerRef.current
    if (last) updateInkHover(last.x, last.y)
    else {
      setInkHoverId(null)
      setGraphicHoverId(null)
      setShapeHoverId(null)
    }
  }
  const refreshInkHoverRef = useRef(refreshInkHover)
  refreshInkHoverRef.current = refreshInkHover

  // The page moved under a still pointer: scroll, zoom, page turn, or the strokes / tool changed.
  useEffect(() => {
    refreshInkHoverRef.current()
  }, [cssScale, spread, sizes, inkStrokes, graphics, shapes, outlinesOn, selectedInkId, selectedGraphicId, selectedShapeId])
  useEffect(() => {
    const scrollRoot = getScrollRootRef.current()
    if (!scrollRoot) return
    let frame: number | null = null
    const onScroll = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        refreshInkHoverRef.current()
      })
    }
    scrollRoot.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scrollRoot.removeEventListener('scroll', onScroll)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [status.kind])

  // Escape deselects the stroke (and closes its toolbar); hover feedback stays. A running handle drag is cancelled first.
  useEffect(() => {
    if ((selectedInkId === null && selectedGraphicId === null && selectedShapeId === null) || !outlinesOn) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // The Freehand settings popover is open: its own Escape (one level per keypress) closes it first.
      if (document.querySelector('[data-pdf-ink-panel=""]')) return
      event.stopPropagation()
      if (inkResizeRef.current) endInkResize(false)
      else selectTarget(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [selectedInkId, selectedGraphicId, selectedShapeId, outlinesOn])

  /** A press on a resize handle of the selected object: the page must not see it (no pan, tap or text selection). */
  const beginInkResize = (handle: string, event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation()
    if (event.button !== 0 || !event.isPrimary) return
    const shapeId = selectedShapeIdRef.current
    const shape = shapeId ? shapesRef.current?.find((m) => m.id === shapeId) : undefined
    if (shape) {
      const rect = slotsRef.current[shape.pageIndex]?.getBoundingClientRect()
      const pointer = rect && rect.width > 0 ? clientToPageUnit(event.clientX, event.clientY, rect) : null
      if (!rect || !pointer) return
      event.preventDefault()
      window.getSelection()?.removeAllRanges()
      dwellRef.current?.disarm()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
      const end = handle === 'start' || handle === 'end'
      const anchor: InkPoint = end && shape.shape.line ? (handle === 'start' ? [shape.shape.line[0], shape.shape.line[1]] : [shape.shape.line[2], shape.shape.line[3]]) : inkHandlePosition(shape.rect, handle as InkResizeHandle)
      inkResizeRef.current = { pointerId: event.pointerId, kind: 'shape', id: shape.id, pageIndex: shape.pageIndex, handle, offset: [pointer[0] - anchor[0], pointer[1] - anchor[1]], paths: null, box: null, geometry: null }
      return
    }
    const graphicId = selectedGraphicIdRef.current
    const object = graphicId ? graphicsRef.current?.find((o) => o.objectId === graphicId) : undefined
    const id = object ? object.objectId : selectedInkIdRef.current
    const stroke = !object && id ? inkStrokesRef.current?.find((m) => m.id === id) : undefined
    const pageIndex = object ? object.pageIndex : stroke?.pageIndex
    const rect = pageIndex !== undefined ? slotsRef.current[pageIndex]?.getBoundingClientRect() : undefined
    if (!id || pageIndex === undefined || (!object && !stroke) || !rect || rect.width <= 0) return
    const size = sizes[pageIndex]
    const box = object ? object.box : size && stroke ? inkSelectionBox(stroke.paths, stroke.width, size.h / size.w) : null
    const pointer = clientToPageUnit(event.clientX, event.clientY, rect)
    if (!box || !pointer) return
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    dwellRef.current?.disarm()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    const anchor = inkHandlePosition(box, handle as InkResizeHandle)
    inkResizeRef.current = {
      pointerId: event.pointerId,
      kind: object ? 'graphic' : 'ink',
      id,
      pageIndex,
      handle,
      offset: [pointer[0] - anchor[0], pointer[1] - anchor[1]],
      paths: null,
      box: null,
      geometry: null,
    }
  }

  const moveInkResize = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation()
    const drag = inkResizeRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
      endInkResize(false)
      return
    }
    const rect = slotsRef.current[drag.pageIndex]?.getBoundingClientRect()
    const size = sizes[drag.pageIndex]
    const pointer = rect ? clientToPageUnit(event.clientX, event.clientY, rect) : null
    if (!rect || !size || !pointer) return
    const target: InkPoint = [pointer[0] - drag.offset[0], pointer[1] - drag.offset[1]]
    if (drag.kind === 'shape') {
      const mark = shapesRef.current?.find((m) => m.id === drag.id)
      if (!mark) return
      const ratio = size.h / size.w
      let geometry: PdfShapeGeometryResult | null
      if ((mark.kind === 'line' || mark.kind === 'arrow') && (drag.handle === 'start' || drag.handle === 'end')) {
        geometry = moveShapeEndpoint(mark.kind, mark.shape, drag.handle, target, ratio)
      } else {
        geometry = { rect: resizeShapeBox(mark.rect, drag.handle, target, ratio), shape: mark.shape }
      }
      // A move that would collapse the shape keeps the last good geometry.
      if (!geometry) return
      drag.geometry = geometry
      setShapeResize({ id: drag.id, geometry })
      return
    }
    if (drag.kind === 'graphic') {
      const object = graphicsRef.current?.find((o) => o.objectId === drag.id)
      if (!object) return
      const box = resizePdfGraphicBox(object.box, drag.handle, target, size.h / size.w)
      drag.box = box
      setGraphicResize({ id: drag.id, box })
      return
    }
    const stroke = inkStrokesRef.current?.find((m) => m.id === drag.id)
    if (!stroke) return
    const paths = resizeInkPaths(stroke.paths, stroke.width, drag.handle as InkResizeHandle, target, size.h / size.w)
    if (!paths) return
    drag.paths = paths
    setInkResize({ id: drag.id, paths })
  }

  /** End the handle drag; `commit` (release) hands the resized points over, otherwise the stroke snaps back. */
  const endInkResize = (commit: boolean) => {
    const drag = inkResizeRef.current
    inkResizeRef.current = null
    setInkResize(null)
    setGraphicResize(null)
    setShapeResize(null)
    if (!drag) return
    try {
      if (rootRef.current?.hasPointerCapture(drag.pointerId)) rootRef.current.releasePointerCapture(drag.pointerId)
    } catch {
      /* element already detached */
    }
    if (commit && drag.paths) onInkResizeRef.current?.(drag.id, drag.paths)
    if (commit && drag.box) onGraphicResizeRef.current?.(drag.id, drag.box)
    if (commit && drag.geometry) onShapeResizeRef.current?.(drag.id, drag.geometry)
  }

  const releaseInkResize = (event: ReactPointerEvent<HTMLElement>, commit: boolean) => {
    event.stopPropagation()
    const drag = inkResizeRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    endInkResize(commit && event.type === 'pointerup')
  }

  /** Run the eraser over one client sample: sweep from the previous sample (same page) and collect touched strokes. */
  const eraseSample = (x: number, y: number) => {
    const erase = eraseRef.current
    if (!erase) return
    const hit = slotAt(x, y)
    const point = hit ? clientToPageUnit(x, y, hit.rect) : null
    if (!hit || !point) {
      erase.last = null
      return
    }
    const from = erase.last && erase.last.pageIndex === hit.index ? erase.last.point : point
    erase.last = { pageIndex: hit.index, point }
    const radius = pagePx(hit.rect, INK_ERASER_RADIUS_PX.default)
    const ratio = hit.rect.height / hit.rect.width
    const strokes = inkStrokesRef.current ?? NO_INK
    const touched = inkStrokesTouchedBySweep(strokes, hit.index, from, point, radius, ratio)
    if (eraserModeRef.current === 'partial') {
      // Always recomputed from the ORIGINAL stroke and ALL sweeps of the gesture: re-entering the same
      // spot, or crossing a stroke again, can never erase more than the eraser's path covers.
      const pageSweeps = erase.sweeps.get(hit.index) ?? []
      pageSweeps.push({ from, to: point })
      erase.sweeps.set(hit.index, pageSweeps)
      let changedPreview = false
      for (const id of touched) {
        const stroke = strokes.find((m) => m.id === id)
        if (!stroke) continue
        const result = erasePathsWithSweeps(stroke.paths, stroke.width, pageSweeps, radius, ratio)
        if (result.changed) {
          erase.preview.set(id, result.pieces.map((piece) => [...piece]))
          changedPreview = true
        }
      }
      if (changedPreview) setErasePreview(new Map(erase.preview))
      return
    }
    let added = false
    for (const id of touched) {
      if (!erase.ids.has(id)) {
        erase.ids.add(id)
        added = true
      }
    }
    if (added) setErasingIds(new Set(erase.ids))
  }

  const beginErase = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!slotAt(event.clientX, event.clientY)) return
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    selectTarget(null)
    onBlankClickRef.current?.()
    eraseRef.current = { pointerId: event.pointerId, last: null, ids: new Set(), sweeps: new Map(), preview: new Map() }
    eraseSample(event.clientX, event.clientY)
  }

  const moveErase = (event: ReactPointerEvent<HTMLDivElement>) => {
    const erase = eraseRef.current
    if (!erase || event.pointerId !== erase.pointerId) return
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
      endErase(true)
      return
    }
    const native = event.nativeEvent
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    for (const sample of coalesced.length > 0 ? coalesced : [native]) eraseSample(sample.clientX, sample.clientY)
  }

  /** End the Eraser press: `commit` (release) deletes everything touched as one operation, otherwise the preview is dropped and nothing changes. */
  const endErase = (commit: boolean) => {
    const erase = eraseRef.current
    eraseRef.current = null
    setErasingIds(null)
    setErasePreview(null)
    if (!erase) return
    try {
      if (rootRef.current?.hasPointerCapture(erase.pointerId)) rootRef.current.releasePointerCapture(erase.pointerId)
    } catch {
      /* element already detached */
    }
    if (!commit) return
    if (erase.ids.size > 0) onInkEraseRef.current?.([...erase.ids])
    if (erase.preview.size > 0) {
      onInkPartialEraseRef.current?.([...erase.preview].map(([id, pieces]) => ({ id, pieces })))
    }
  }

  // Escape, window blur, leaving the Eraser tool or unmounting mid-gesture: nothing is deleted.
  useEffect(() => {
    if (!eraser) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !eraseRef.current) return
      event.stopPropagation()
      endErase(false)
    }
    const onBlur = () => endErase(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
      endErase(false)
    }
  }, [eraser])

  /** Hand + a press on the SELECTED stroke: drag it. (An unselected stroke is only selected, by the click.) */
  const beginInkMove = (event: ReactPointerEvent<HTMLDivElement>): boolean => {
    const selected = selectedInkIdRef.current
    if (!handRef.current || !selected) return false
    const hit = inkAt(event.clientX, event.clientY)
    if (!hit || hit.id !== selected) return false
    dwellRef.current?.disarm()
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    inkMoveRef.current = { pointerId: event.pointerId, id: hit.id, pageIndex: hit.pageIndex, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0, moved: false }
    return true
  }

  const moveInkDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = inkMoveRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
      endInkMove(false)
      return
    }
    const rect = slotsRef.current[drag.pageIndex]?.getBoundingClientRect()
    const stroke = inkStrokesRef.current?.find((m) => m.id === drag.id)
    if (!rect || rect.width <= 0 || !stroke) return
    if (!drag.moved && !exceedsDragThreshold(drag.startX, drag.startY, event.clientX, event.clientY)) return
    drag.moved = true
    const shift = translateInkPaths(stroke.paths, (event.clientX - drag.startX) / rect.width, (event.clientY - drag.startY) / rect.height)
    drag.dx = shift.dx
    drag.dy = shift.dy
    if (inkMoveFrameRef.current === null) {
      inkMoveFrameRef.current = requestAnimationFrame(() => {
        inkMoveFrameRef.current = null
        const current = inkMoveRef.current
        if (current) setInkMove({ id: current.id, dx: current.dx, dy: current.dy })
      })
    }
  }

  /** End the stroke drag; `commit` hands the shift over (release), otherwise the stroke snaps back (cancel / blur). */
  const endInkMove = (commit: boolean) => {
    const drag = inkMoveRef.current
    inkMoveRef.current = null
    if (inkMoveFrameRef.current !== null) {
      cancelAnimationFrame(inkMoveFrameRef.current)
      inkMoveFrameRef.current = null
    }
    setInkMove(null)
    if (!drag) return
    try {
      if (rootRef.current?.hasPointerCapture(drag.pointerId)) rootRef.current.releasePointerCapture(drag.pointerId)
    } catch {
      /* element already detached */
    }
    if (commit && drag.moved) onInkMoveRef.current?.(drag.id, drag.dx, drag.dy)
  }

  /** Shape tool: a press starts a drag on the page under it; the preview follows, release creates the shape. */
  const beginShape = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pen = shapePenRef.current
    const hit = slotAt(event.clientX, event.clientY)
    const point = hit ? clientToPageUnit(event.clientX, event.clientY, hit.rect) : null
    if (!pen || !hit || !point) return
    // Not a text selection, not a page turn, not a pan: the press belongs to the shape tool.
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    selectTarget(null)
    onBlankClickRef.current?.()
    shapeDraftRef.current = { pointerId: event.pointerId, pageIndex: hit.index, kind: pen.kind, start: point, end: point }
    setShapeDraft({ pageIndex: hit.index, kind: pen.kind, start: point, end: point, colorHex: pen.colorHex, width: pen.width, opacity: pen.opacity })
  }

  const moveShape = (event: ReactPointerEvent<HTMLDivElement>) => {
    const draft = shapeDraftRef.current
    if (!draft || event.pointerId !== draft.pointerId) return
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
      // Released somewhere we never heard about (outside the window): that is a release.
      endShape(true)
      return
    }
    const rect = slotsRef.current[draft.pageIndex]?.getBoundingClientRect()
    // Clamped to the page the drag started on: a shape never leaves its page.
    const point = rect && rect.width > 0 ? clientToPageUnit(event.clientX, event.clientY, rect) : null
    if (!point) return
    draft.end = point
    setShapeDraft((prev) => (prev ? { ...prev, end: point } : prev))
  }

  /** End the drag: commit (release) creates the shape when it is big enough; otherwise (Escape, blur, cancel) nothing is created. */
  const endShape = (commit: boolean) => {
    const draft = shapeDraftRef.current
    shapeDraftRef.current = null
    setShapeDraft(null)
    if (!draft) return
    try {
      if (rootRef.current?.hasPointerCapture(draft.pointerId)) rootRef.current.releasePointerCapture(draft.pointerId)
    } catch {
      /* element already detached */
    }
    if (!commit) return
    const rect = slotsRef.current[draft.pageIndex]?.getBoundingClientRect()
    const pen = shapePenRef.current
    if (!rect || !pen || rect.width <= 0) return
    const geometry = shapeFromDrag(draft.kind, draft.start, draft.end, pen.width, rect.height / rect.width)
    if (geometry) onShapeCreateRef.current?.(draft.pageIndex, draft.kind, geometry)
  }

  /** The saved Typewriter note under the pointer (topmost), or null. */
  const typewriterAt = (clientX: number, clientY: number): PdfTypewriterMark | null => {
    const hit = slotAt(clientX, clientY)
    const point = hit ? clientToPageUnit(clientX, clientY, hit.rect) : null
    const marks = hit ? typewritersByPageRef.current.get(hit.index) : undefined
    return point && marks ? typewriterBoxAt(marks, point[0], point[1], 0.004, 0.004) : null
  }

  /** Typewriter tool: a press places a box (click) or sizes one (drag); with a note open it only commits that note. */
  const beginTypewriter = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    if (typewriterEditingRef.current) {
      onTypewriterOutsideRef.current?.()
      return
    }
    // A press on a saved note selects it instead of placing another box.
    const note = typewriterAt(event.clientX, event.clientY)
    if (note) {
      selectTarget(null)
      onTypewriterSelectRef.current?.(note.id)
      return
    }
    const hit = slotAt(event.clientX, event.clientY)
    const point = hit ? clientToPageUnit(event.clientX, event.clientY, hit.rect) : null
    if (!hit || !point) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    selectTarget(null)
    onBlankClickRef.current?.()
    typewriterDragRef.current = { pointerId: event.pointerId, pageIndex: hit.index, start: point, end: point, startClient: [event.clientX, event.clientY] }
  }

  const moveTypewriter = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = typewriterDragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const rect = slotsRef.current[drag.pageIndex]?.getBoundingClientRect()
    const point = rect && rect.width > 0 ? clientToPageUnit(event.clientX, event.clientY, rect) : null
    if (!point) return
    drag.end = point
    if (Math.hypot(event.clientX - drag.startClient[0], event.clientY - drag.startClient[1]) > PAN_DRAG_THRESHOLD_PX) {
      setTypewriterRubber({ pageIndex: drag.pageIndex, start: drag.start, end: point })
    }
  }

  const endTypewriter = (commit: boolean, event?: ReactPointerEvent<HTMLDivElement>) => {
    const drag = typewriterDragRef.current
    typewriterDragRef.current = null
    setTypewriterRubber(null)
    if (!drag) return
    try {
      if (rootRef.current?.hasPointerCapture(drag.pointerId)) rootRef.current.releasePointerCapture(drag.pointerId)
    } catch {
      /* element already detached */
    }
    const rect = slotsRef.current[drag.pageIndex]?.getBoundingClientRect()
    if (!commit || !rect || rect.width <= 0) return
    const moved = event ? Math.hypot(event.clientX - drag.startClient[0], event.clientY - drag.startClient[1]) > PAN_DRAG_THRESHOLD_PX : false
    const heightRatio = rect.height / rect.width
    if (moved) {
      const x = Math.min(drag.start[0], drag.end[0])
      const y = Math.min(drag.start[1], drag.end[1])
      const width = Math.max(0.04, Math.abs(drag.end[0] - drag.start[0]))
      const height = Math.abs(drag.end[1] - drag.start[1])
      onTypewriterBeginRef.current?.({ pageIndex: drag.pageIndex, box: { x: Math.min(x, 1 - width), y, width, height }, heightRatio })
    } else {
      const width = 0.25
      onTypewriterBeginRef.current?.({ pageIndex: drag.pageIndex, box: { x: Math.min(drag.start[0], 1 - width), y: drag.start[1], width, height: 0 }, heightRatio })
    }
  }

  // Escape (back to Select is the Reader's), window blur or leaving the tool mid-drag: nothing is created.
  useEffect(() => {
    if (!shapeTool) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !shapeDraftRef.current) return
      event.stopPropagation()
      endShape(false)
    }
    const onBlur = () => endShape(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
      endShape(false)
    }
  }, [shapeTool])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return
    if (penRef.current) {
      beginInk(event)
      return
    }
    if (eraserRef.current) {
      beginErase(event)
      return
    }
    if (shapeToolRef.current) {
      beginShape(event)
      return
    }
    if (typewriterToolRef.current) {
      beginTypewriter(event)
      return
    }
    // A press elsewhere commits a note that is being edited, then goes on as usual.
    if (typewriterEditingRef.current) onTypewriterOutsideRef.current?.()
    // Select and Hand mode: one click selects a note (never a text selection under it, never a pan); a press on the
    // selected note itself is handled by its own overlay (move / resize), so this only ever selects.
    if (selectToolRef.current || handRef.current) {
      const note = typewriterAt(event.clientX, event.clientY)
      if (note) {
        event.preventDefault()
        window.getSelection()?.removeAllRanges()
        selectTarget(null)
        onTypewriterSelectRef.current?.(note.id)
        return
      }
    }
    if (beginInkMove(event)) return
    // Hand: a press on text the dwell has armed selects natively; every other press pans.
    const pan =
      handRef.current &&
      !(dwellRef.current?.isArmed() && isTextAt(event.clientX, event.clientY))
    if (pan) {
      dwellRef.current?.disarm()
      // Synchronously, so `user-select: none` is in place before a selection could start.
      setSurfaceFlag('data-pdf-grabbing', true)
      event.preventDefault()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
    }
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      pan,
      selectionAtDown: hasTextSelection() ? (window.getSelection()?.getRangeAt(0).cloneRange() ?? null) : null,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (inkDraftRef.current) {
      moveInk(event)
      return
    }
    if (eraseRef.current) {
      moveErase(event)
      return
    }
    if (shapeDraftRef.current) {
      moveShape(event)
      return
    }
    if (typewriterDragRef.current) {
      moveTypewriter(event)
      return
    }
    if (inkMoveRef.current) {
      moveInkDrag(event)
      return
    }
    const gesture = gestureRef.current
    if (!gesture) {
      if ((event.buttons & 1) === 0) {
        lastPointerRef.current = { x: event.clientX, y: event.clientY }
        updateInkHover(event.clientX, event.clientY)
        const overNote = typewritersByPageRef.current.size > 0 ? (typewriterAt(event.clientX, event.clientY)?.id ?? null) : null
        setTypewriterHoverId((prev) => (prev === overNote ? prev : overNote))
      }
      // Hand over the selected stroke: the move cursor says it can be dragged.
      setSurfaceFlag(
        'data-pdf-ink-hover',
        handRef.current && (event.buttons & 1) === 0 && selectedInkIdRef.current != null && inkAt(event.clientX, event.clientY)?.id === selectedInkIdRef.current,
      )
      // Hover (no button): feed the dwell. Never while a press is in progress.
      if (handRef.current && (event.buttons & 1) === 0) {
        dwellRef.current?.update(isTextAt(event.clientX, event.clientY))
      }
      reportAnnotationHover((event.buttons & 1) === 0 ? annotationAt(event.clientX, event.clientY) : null)
      return
    }
    reportAnnotationHover(null)
    setInkHoverId(null)
    setGraphicHoverId(null)
    setShapeHoverId(null)
    if (event.pointerId !== gesture.pointerId) return
    if ((event.buttons & 1) === 0) {
      // Released somewhere we never heard about (e.g. outside the window while selecting).
      endGesture()
      return
    }
    const dx = event.clientX - gesture.lastX
    const dy = event.clientY - gesture.lastY
    gesture.lastX = event.clientX
    gesture.lastY = event.clientY
    if (
      !gesture.moved &&
      exceedsDragThreshold(gesture.startX, gesture.startY, event.clientX, event.clientY)
    ) {
      gesture.moved = true
    }
    if (!gesture.pan) return
    if (onHandPanByRef.current) {
      onHandPanByRef.current(dx, dy)
    } else {
      const root = getScrollRootRef.current()
      if (root) {
        root.scrollLeft -= dx
        root.scrollTop -= dy
      }
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (inkDraftRef.current) {
      if (event.pointerId === inkDraftRef.current.pointerId) finishInk()
      return
    }
    if (eraseRef.current) {
      if (event.pointerId === eraseRef.current.pointerId) endErase(true)
      return
    }
    if (shapeDraftRef.current) {
      if (event.pointerId === shapeDraftRef.current.pointerId) endShape(true)
      return
    }
    if (typewriterDragRef.current) {
      if (event.pointerId === typewriterDragRef.current.pointerId) endTypewriter(true, event)
      return
    }
    if (inkMoveRef.current) {
      if (event.pointerId === inkMoveRef.current.pointerId) endInkMove(true)
      return
    }
    const gesture = gestureRef.current
    if (!gesture || event.pointerId !== gesture.pointerId) return
    endGesture()
    if (event.button !== 0) return
    // Markup tool armed: a press that leaves text selected (drag, double / triple click) marks it.
    const tool = markupToolRef.current
    // Insert Text: the press marks a point, never a selection. A saved caret under the pointer opens
    // its editor instead of stacking a second one.
    if (tool === 'insert' && !gesture.pan && rootRef.current) {
      window.getSelection()?.removeAllRanges()
      const existing = annotationAt(event.clientX, event.clientY)
      if (existing) {
        onAnnotationClickRef.current?.(existing)
        return
      }
      const point = readPdfInsertionPoint(rootRef.current, event.clientX, event.clientY)
      if (point) onInsertPointRef.current?.(point)
      else onBlankClickRef.current?.()
      return
    }
    // Only a selection THIS press made: a press that landed on non-selectable space (a gap, the
    // `.endOfContent` filler) leaves an older selection untouched, and committing that one would
    // mark text the user never dragged.
    if (tool && !gesture.pan && rootRef.current && selectionChangedSince(gesture.selectionAtDown)) {
      const selection = readPdfSelection(rootRef.current)
      if (selection) {
        onMarkupSelectionRef.current?.(selection, tool)
        return
      }
    }
    if (gesture.moved) return
    // A press that leaves a selection behind (double / triple click on text) is not a tap. A pan
    // press can't select, so an older selection there is just what the tap should clear.
    if (!gesture.pan && hasTextSelection()) return
    const hit = annotationAt(event.clientX, event.clientY)
    if (hit) {
      selectTarget(null)
      onAnnotationClickRef.current?.(hit)
      return
    }
    // A click on a freehand stroke selects it (Delete removes it); the text-markup UI closes.
    const target = outlinesOnRef.current ? targetAt(event.clientX, event.clientY) : null
    if (target) {
      onBlankClickRef.current?.()
      selectTarget(target)
      return
    }
    selectTarget(null)
    onBlankClickRef.current?.()
    const root = getScrollRootRef.current()
    if (!root) return
    const rect = root.getBoundingClientRect()
    if (isInCenterTapZone(event.clientX, rect)) {
      onCenterTapRef.current?.()
    } else if (pagedRef.current) {
      // Paged flow: a tap on the outer quarters turns the page, like a book's edges.
      stepSpread(event.clientX > rect.left + rect.width / 2 ? 1 : -1)
    }
  }

  // Like the EPUB surface: never the native menu on the pages; inside a selection, ours; on an
  // annotation (outside a selection), that annotation's menu.
  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const root = rootRef.current
    if (!root) return
    const selection = readPdfSelectionAt(root, event.clientX, event.clientY)
    if (selection) {
      onSelectionContextMenuRef.current?.(selection, event.clientX, event.clientY)
      return
    }
    const note = typewritersByPageRef.current.size > 0 ? typewriterAt(event.clientX, event.clientY) : null
    if (note) {
      onTypewriterPropertiesRef.current?.(note.id)
      return
    }
    const hit = annotationAt(event.clientX, event.clientY)
    if (hit) onAnnotationContextMenuRef.current?.(hit)
  }

  if (status.kind === 'error') {
    return (
      <div className="flex h-full w-full" data-pdf-status="error">
        <p role="alert" className="m-auto text-sm">
          {status.message}
        </p>
      </div>
    )
  }

  /** The outline target (id + box, as painted — previews included) of the selected / hover-outlined object on page `index`. The selected one is never hover-outlined. */
  const markOn = (id: string | null, index: number) => (id === null ? null : (inkByPage.get(index)?.find((m) => m.id === id) ?? null))
  const inkBoxOf = (mark: PdfInkLayerMark, index: number) => {
    const size = sizes[index]
    return size ? inkSelectionBox(mark.paths, mark.width, size.h / size.w) : null
  }
  const shapeOn = (id: string | null, index: number) => (id === null ? null : (shapesByPage.get(index)?.find((m) => m.id === id) ?? null))
  const graphicOn = (id: string | null, index: number) => (id === null ? null : (graphics?.find((o) => o.objectId === id && o.pageIndex === index) ?? null))
  const selectedTargetOn = (index: number) => {
    const mark = markOn(selectedInkId, index)
    const markBox = mark ? inkBoxOf(mark, index) : null
    if (mark && markBox) return { id: mark.id, box: markBox, resizable: canResizeInk(mark.paths, sizes[index] ? sizes[index]!.h / sizes[index]!.w : 1) }
    const shapeMark = shapeOn(selectedShapeId, index)
    if (shapeMark) {
      const line = shapeMark.shape.line
      const handles: PdfCustomHandle[] | undefined =
        (shapeMark.kind === 'line' || shapeMark.kind === 'arrow') && line
          ? [
              { key: 'start', x: line[0], y: line[1] },
              { key: 'end', x: line[2], y: line[3] },
            ]
          : undefined
      return { id: shapeMark.id, box: shapeMark.rect, resizable: true, handles }
    }
    const object = graphicOn(selectedGraphicId, index)
    if (!object) return null
    return { id: object.objectId, box: graphicResize?.id === object.objectId ? graphicResize.box : object.box, resizable: object.caps.resize }
  }
  const hoverTargetOn = (index: number) => {
    const mark = markOn(inkHoverId !== selectedInkId ? inkHoverId : null, index)
    const markBox = mark ? inkBoxOf(mark, index) : null
    if (mark && markBox) return { id: mark.id, box: markBox }
    const shapeMark = shapeOn(shapeHoverId !== selectedShapeId ? shapeHoverId : null, index)
    if (shapeMark) return { id: shapeMark.id, box: shapeMark.rect }
    const object = graphicOn(graphicHoverId !== selectedGraphicId ? graphicHoverId : null, index)
    return object ? { id: object.objectId, box: object.box } : null
  }
  const toolbarOn = (index: number): ReactNode => {
    const mark = markOn(selectedInkId, index)
    if (mark) return renderInkToolbar ? renderInkToolbar(mark) : null
    const shapeMark = shapeOn(selectedShapeId, index)
    if (shapeMark) return renderShapeToolbar ? renderShapeToolbar(shapeMark) : null
    const object = graphicOn(selectedGraphicId, index)
    return object && renderGraphicToolbar ? renderGraphicToolbar(object) : null
  }

  const pageRows: ReactNode[] = []
  for (let first = 0; first < sizes.length; first += pagesPerView) {
    const row = first / pagesPerView
    const shown = !paged || row === spread || row === leaving
    pageRows.push(
      <div
        key={row}
        ref={(el) => {
          rowsRef.current[row] = el
        }}
        className="relative items-start justify-center"
        style={{
          display: shown ? 'flex' : 'none',
          gap,
          ...(paged ? { gridArea: '1 / 1', transformOrigin: '0% 50%' } : null),
        }}
        data-pdf-row={row}
      >
        {sizes.slice(first, first + pagesPerView).map((size, offset) => {
          const index = first + offset
          return (
            <div
              key={index}
              ref={(el) => {
                slotsRef.current[index] = el
              }}
              className="relative shrink-0 bg-white shadow"
              style={{ width: Math.floor(size.w * cssScale), height: Math.floor(size.h * cssScale) }}
              data-page-number={index + 1}
              // Ctrl+wheel / toolbar zoom anchors to the page under the focal point (ReaderZoomViewport).
              data-zoom-anchor=""
            >
              {marksByPage.has(index + 1) ? (
                <PdfPageAnnotations
                  page={index + 1}
                  marks={marksByPage.get(index + 1)!}
                  focusedId={focusedAnnotationId}
                  flash={flash}
                />
              ) : null}
              {shapesByPage.has(index) || shapeDraft?.pageIndex === index ? (
                <PdfPageShapes
                  heightRatio={size.h / size.w}
                  marks={shapesByPage.get(index) ?? []}
                  draft={shapeDraft?.pageIndex === index ? shapeDraft : null}
                  flash={flash as PdfShapeFlash | null}
                />
              ) : null}
              {typewritersByPage.has(index) || renderTypewriterEditor?.(index, size.h / size.w) || typewriterRubber?.pageIndex === index ? (
                <PdfPageTypewriters
                  marks={typewritersByPage.get(index) ?? []}
                  heightRatio={size.h / size.w}
                  flash={flash as PdfTypewriterFlash | null}
                  selectedId={selectedTypewriterId}
                  hoverId={typewriterHoverId}
                  hiddenId={editingTypewriterId}
                  editOnClick={selectToolRef.current}
                  onBox={(id, box) => onTypewriterBox?.(id, box, size.h / size.w)}
                  onEdit={(id) => onTypewriterEdit?.(id, size.h / size.w)}
                  onDelete={(id) => onTypewriterDelete?.(id)}
                  onProperties={(id) => onTypewriterProperties?.(id)}
                >
                  {renderTypewriterEditor?.(index, size.h / size.w)}
                  {typewriterRubber?.pageIndex === index ? (
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        left: `${Math.min(typewriterRubber.start[0], typewriterRubber.end[0]) * 100}%`,
                        top: `${Math.min(typewriterRubber.start[1], typewriterRubber.end[1]) * 100}%`,
                        width: `${Math.abs(typewriterRubber.end[0] - typewriterRubber.start[0]) * 100}%`,
                        height: `${Math.abs(typewriterRubber.end[1] - typewriterRubber.start[1]) * 100}%`,
                        border: '1px dashed #1E88E5',
                      }}
                    />
                  ) : null}
                </PdfPageTypewriters>
              ) : null}
              {inkByPage.has(index) || inkDraft?.pageIndex === index ? (
                <PdfPageInk
                  heightRatio={size.h / size.w}
                  strokes={inkByPage.get(index) ?? NO_INK}
                  draft={
                    inkDraft?.pageIndex === index
                      ? {
                          pageIndex: index,
                          points: inkDraft.points,
                          width: inkPen?.width ?? 0.004,
                          colorHex: inkPen?.colorHex ?? '#1E88E5',
                          opacity: inkPen?.opacity ?? 1,
                          penStyle: inkPen?.penStyle ?? 'pen',
                        }
                      : null
                  }
                  selectedId={selectedInkId}
                  erasingIds={erasingIds}
                />
              ) : null}
              {outlinesOn && (selectedTargetOn(index) || hoverTargetOn(index)) ? (
                <PdfInkSelectionOverlay
                  pageHeightPx={Math.floor(size.h * cssScale)}
                  hovered={hoverTargetOn(index)}
                  selected={selectedTargetOn(index)}
                  toolbar={toolbarOn(index)}
                  onHandleDown={beginInkResize}
                  onHandleMove={moveInkResize}
                  onHandleUp={releaseInkResize}
                />
              ) : null}
            </div>
          )
        })}
      </div>,
    )
  }

  return (
    <div
      ref={rootRef}
      // Cursor + text selection per tool come from `[data-pdf-tool]` rules in index.css (they must
      // beat pdf_viewer.css, and `ReaderShell` is `select-none` for the whole reader).
      className="flex flex-col items-center"
      style={{ gap, padding: pad, touchAction: pen || eraser || shapeTool || typewriterTool ? 'none' : undefined }}
      data-pdf-status={status.kind}
      data-pdf-pages={sizes.length}
      data-pdf-flow={flow}
      data-pdf-per-view={pagesPerView}
      data-pdf-tool={pen ? 'pen' : eraser ? 'eraser' : shapeTool ? 'shape' : typewriterTool ? 'typewriter' : hand ? 'hand' : 'select'}
      // Pen cursor per drawing style (index.css).
      data-pdf-ink-style={pen ? (inkPen?.penStyle ?? 'pen') : undefined}
      // Highlight / Underline / Strikethrough: Select's surface with the tool's pen cursor.
      data-pdf-markup={markupTool ?? undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        finishInk()
        endErase(false)
        endShape(false)
        endTypewriter(false)
        endInkMove(false)
        endInkResize(false)
        void endGesture()
      }}
      onContextMenu={onContextMenu}
      onDoubleClick={(event) => {
        // Hand mode: a single press already selects a note (onPointerDown); this stays for a double-click that lands before the overlay exists.
        if (!handRef.current) return
        const note = typewriterAt(event.clientX, event.clientY)
        if (!note) return
        window.getSelection()?.removeAllRanges()
        onTypewriterSelectRef.current?.(note.id)
      }}
      onLostPointerCapture={() => {
        if (inkDraftRef.current) finishInk()
        if (eraseRef.current) endErase(false)
        if (shapeDraftRef.current) endShape(false)
        if (typewriterDragRef.current) endTypewriter(false)
        if (inkMoveRef.current) endInkMove(false)
        if (gestureRef.current?.pan) endGesture()
      }}
      onPointerLeave={() => {
        lastPointerRef.current = null
        setInkHoverId(null)
        setGraphicHoverId(null)
        setShapeHoverId(null)
        reportAnnotationHover(null)
        if (!gestureRef.current) dwellRef.current?.update(false)
      }}
    >
      {status.kind === 'loading' ? <p className="mt-6 text-sm">Loading PDF…</p> : null}
      {paged ? (
        <div className="grid" style={{ perspective: '2400px' }}>
          {pageRows}
        </div>
      ) : (
        pageRows
      )}
    </div>
  )
}
