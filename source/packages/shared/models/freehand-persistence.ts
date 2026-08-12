/**

 * Freehand stroke geometry ↔ opaque `annotations.location_data` (T5.11b / T5.11e).

 */



import type {

  FreehandPathLocation,

  FreehandPoint,

  ReaderAnnotationStatus,

  ReaderShapeAnnotation,

} from './reader-session.js'



const DEFAULT_STROKE_COLOR = '#ef4444'

const DEFAULT_STROKE_WIDTH = 2



function clamp01(value: number): number {

  if (!Number.isFinite(value)) return 0

  return Math.min(1, Math.max(0, value))

}



function normalizePoint(raw: unknown): FreehandPoint | null {

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const obj = raw as Record<string, unknown>

  const x = obj.x

  const y = obj.y

  if (typeof x !== 'number' || !Number.isFinite(x)) return null

  if (typeof y !== 'number' || !Number.isFinite(y)) return null

  return { x: clamp01(x), y: clamp01(y) }

}



function readerStatus(value: string): ReaderAnnotationStatus {

  return value === 'Review' || value === 'Done' ? value : 'None'

}



function styleString(

  style: Record<string, unknown> | undefined,

  key: string,

): string | undefined {

  const value = style?.[key]

  return typeof value === 'string' && value.trim() ? value.trim() : undefined

}



function styleNumber(

  style: Record<string, unknown> | undefined,

  key: string,

): number | undefined {

  const value = style?.[key]

  return typeof value === 'number' && Number.isFinite(value) ? value : undefined

}



type AnnotationDtoLike = {

  id: string

  type: string

  pageNumber?: number

  locationData: string

  content?: string

  style?: Record<string, unknown>

  status: string

  isChecked: boolean

  createdAt: string

  updatedAt: string

}



export type FreehandAnnotationInput = {

  bookId: string

  id: string

  type: 'freehand'

  pageNumber: number

  locationData: string

  content?: string

  style: { colorHex: string; strokeWidth: number }

  status: ReaderAnnotationStatus

  isChecked: boolean

  createdAt: string

  updatedAt: string

}



/** Parse opaque `location_data` for freehand path annotations. */

export function parseFreehandLocation(raw: string): FreehandPathLocation | null {

  try {

    const parsed: unknown = JSON.parse(raw)

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {

      return null

    }

    const obj = parsed as Record<string, unknown>

    if (obj.v !== 1 || obj.kind !== 'path') return null

    if (!Array.isArray(obj.points) || obj.points.length === 0) return null

    const points: FreehandPoint[] = []

    for (const entry of obj.points) {

      const point = normalizePoint(entry)

      if (!point) return null

      points.push(point)

    }

    return { v: 1, kind: 'path', points }

  } catch {

    return null

  }

}



export function serializeFreehandLocation(loc: FreehandPathLocation): string {

  return JSON.stringify({

    v: 1,

    kind: 'path',

    points: loc.points.map((p) => ({

      x: clamp01(p.x),

      y: clamp01(p.y),

    })),

  })

}



/** Clamp and serialize a path from raw points. */

export function serializeFreehandPoints(points: FreehandPoint[]): string {

  return serializeFreehandLocation({

    v: 1,

    kind: 'path',

    points,

  })

}



/** Drop near-duplicate samples so strokes stay compact while drawing. */

export function appendFreehandPoint(

  points: FreehandPoint[],

  next: FreehandPoint,

  minDelta = 0.002,

): FreehandPoint[] {

  const point = { x: clamp01(next.x), y: clamp01(next.y) }

  const last = points[points.length - 1]

  if (last) {

    const dx = point.x - last.x

    const dy = point.y - last.y

    if (dx * dx + dy * dy < minDelta * minDelta) return points

  }

  return [...points, point]

}



export function clampFreehandPoint(point: FreehandPoint): FreehandPoint {

  return { x: clamp01(point.x), y: clamp01(point.y) }

}



/** Map client coords → normalized 0..1 relative to a host element rect. */

export function clientPointToNormalized(

  clientX: number,

  clientY: number,

  hostRect: { left: number; top: number; width: number; height: number },

): FreehandPoint | null {

  if (hostRect.width <= 0 || hostRect.height <= 0) return null

  return {

    x: clamp01((clientX - hostRect.left) / hostRect.width),

    y: clamp01((clientY - hostRect.top) / hostRect.height),

  }

}



export function readerFreehandPageNumber(stroke: ReaderShapeAnnotation): number {

  return Math.max(1, Math.floor(stroke.chapterIndex) + 1)

}



/** Session stroke → SQLite `annotations` row (`type=freehand`). */

export function readerFreehandToAnnotationInput(

  bookId: string,

  stroke: ReaderShapeAnnotation,

): FreehandAnnotationInput {

  const locationData =

    stroke.locationData?.trim() || serializeFreehandPoints(stroke.points)

  return {

    bookId,

    id: stroke.id,

    type: 'freehand',

    pageNumber: readerFreehandPageNumber(stroke),

    locationData,

    content: 'Freehand',

    style: {

      colorHex: stroke.colorHex || DEFAULT_STROKE_COLOR,

      strokeWidth: Math.max(1, stroke.strokeWidth || DEFAULT_STROKE_WIDTH),

    },

    status: stroke.status ?? 'None',

    isChecked: stroke.isChecked ?? false,

    createdAt: stroke.createdAt,

    updatedAt: stroke.updatedAt,

  }

}



/** SQLite row → in-memory pencil stroke for repaint. */

export function annotationDtoToReaderFreehand(

  dto: AnnotationDtoLike,

): ReaderShapeAnnotation | null {

  if (dto.type !== 'freehand') return null

  const loc = parseFreehandLocation(dto.locationData)

  if (!loc || loc.points.length === 0) return null



  const style = dto.style ?? {}

  const colorHex =

    styleString(style, 'colorHex')?.toLowerCase() ?? DEFAULT_STROKE_COLOR

  const strokeWidthRaw = styleNumber(style, 'strokeWidth')

  const strokeWidth =

    strokeWidthRaw != null && strokeWidthRaw > 0

      ? strokeWidthRaw

      : DEFAULT_STROKE_WIDTH

  const chapterIndex =

    typeof dto.pageNumber === 'number' && Number.isFinite(dto.pageNumber)

      ? Math.max(0, Math.floor(dto.pageNumber) - 1)

      : 0



  return {

    id: dto.id,

    type: 'freehand',

    chapterIndex,

    locationData: dto.locationData,

    points: loc.points,

    colorHex,

    strokeWidth,

    status: readerStatus(dto.status),

    isChecked: dto.isChecked,

    createdAt: dto.createdAt,

    updatedAt: dto.updatedAt,

  }

}


