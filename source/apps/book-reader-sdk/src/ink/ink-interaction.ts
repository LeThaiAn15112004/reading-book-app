/**
 * Hover / Selected / Deselected interaction states of PDF Ink strokes (UI only: nothing here is persisted
 * into the PDF or the annotation data) plus the pure geometry behind the selection chrome — bounding box,
 * resize handles, contextual toolbar side — and the deterministic hit pick for overlapping strokes.
 *
 * Coordinates are the storage space of `ink-geometry.ts`: x and y both 0–1 over the page box; distances
 * and pen widths are in page-width units (y × `heightRatio`).
 */

import { inkStrokeAt } from './ink-geometry.js'
import type { InkPoint } from './pdf-ink.js'

/** A box in normalized page units. */
export type InkBox = { x: number; y: number; width: number; height: number }

/** What the pointer is doing to the Ink objects of the page, as plain data. */
export type InkInteraction = {
  /** Stroke under the pointer (outline only). Never the selected one. */
  hoverId: string | null
  /** Stroke with handles + contextual toolbar. */
  selectedId: string | null
}

export const INK_INTERACTION_IDLE: InkInteraction = { hoverId: null, selectedId: null }

export type InkInteractionEvent =
  | { type: 'hover'; id: string | null }
  | { type: 'select'; id: string }
  /** Click on empty space, a tool switch, a page change away from the selection. */
  | { type: 'clear' }
  | { type: 'escape' }
  /** These strokes no longer exist (delete, erase, undo). */
  | { type: 'removed'; ids: readonly string[] }

/**
 * The state machine. Hover never selects and never changes the selection; the selected stroke takes
 * precedence over hover (it is never hover-outlined); selecting drops any hover; Escape and a clear
 * deselect and keep hover feedback available for the next pointer move.
 */
export function reduceInkInteraction(state: InkInteraction, event: InkInteractionEvent): InkInteraction {
  switch (event.type) {
    case 'hover': {
      const id = event.id !== null && event.id === state.selectedId ? null : event.id
      return id === state.hoverId ? state : { ...state, hoverId: id }
    }
    case 'select':
      return state.selectedId === event.id && state.hoverId === null ? state : { hoverId: null, selectedId: event.id }
    case 'clear':
    case 'escape':
      return state.selectedId === null ? state : { ...state, selectedId: null }
    case 'removed': {
      const gone = new Set(event.ids)
      const selectedId = state.selectedId !== null && gone.has(state.selectedId) ? null : state.selectedId
      const hoverId = state.hoverId !== null && gone.has(state.hoverId) ? null : state.hoverId
      return selectedId === state.selectedId && hoverId === state.hoverId ? state : { hoverId, selectedId }
    }
  }
}

/** Hover / selection outlines are only offered in the plain reading modes (Hand / Select), never while a pen, eraser or text-markup tool is armed. */
export function inkOutlinesAvailable(tool: { pen: boolean; eraser: boolean; markup: boolean }): boolean {
  return !tool.pen && !tool.eraser && !tool.markup
}

/**
 * The stroke a pointer at (`x`, `y`) refers to. Deterministic for overlapping strokes: the SELECTED stroke
 * wins wherever it is hit (so it stays grabbable under a later stroke); otherwise the topmost one (last
 * drawn). Null on empty space.
 */
export function pickInkTarget<T extends { id: string; pageIndex: number; paths: readonly (readonly InkPoint[])[]; width: number }>(
  strokes: readonly T[],
  selectedId: string | null,
  pageIndex: number,
  x: number,
  y: number,
  heightRatio: number,
  slop: number,
): T | null {
  if (selectedId !== null) {
    const selected = strokes.find((s) => s.id === selectedId)
    if (selected && inkStrokeAt([selected], pageIndex, x, y, heightRatio, slop)) return selected
  }
  return inkStrokeAt(strokes, pageIndex, x, y, heightRatio, slop)
}

/** Space the selection outline keeps around the pen edge, page-width units. */
export const INK_OUTLINE_MARGIN = 0.003

/** Bounding box of the drawn stroke: every point, grown by half the pen width and the outline margin. Null for no points. */
export function inkSelectionBox(paths: readonly (readonly InkPoint[])[], penWidth: number, heightRatio: number): InkBox | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const path of paths) {
    for (const [x, y] of path) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (!Number.isFinite(minX) || !(heightRatio > 0)) return null
  const pad = penWidth / 2 + INK_OUTLINE_MARGIN
  const padY = pad / heightRatio
  return { x: minX - pad, y: minY - padY, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * padY }
}

export type InkResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const INK_RESIZE_HANDLES: readonly InkResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Smallest stroke extent (page-width units) a resize may produce. */
export const INK_MIN_RESIZE_EXTENT = 0.02

function pointBounds(paths: readonly (readonly InkPoint[])[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const path of paths) {
    for (const [x, y] of path) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

/**
 * Resizing is only offered for a stroke with a real extent on BOTH axes: a dot or a perfectly straight
 * horizontal / vertical line has nothing to scale along one axis, so it gets colour + delete only.
 */
export function canResizeInk(paths: readonly (readonly InkPoint[])[], heightRatio: number): boolean {
  const b = pointBounds(paths)
  if (!b || !(heightRatio > 0)) return false
  return b.maxX - b.minX >= INK_MIN_RESIZE_EXTENT / 2 && (b.maxY - b.minY) * heightRatio >= INK_MIN_RESIZE_EXTENT / 2
}

/**
 * Drag one handle of the stroke's point bounds to `pointer` (normalized page position of the handle
 * itself, i.e. on the padded outline box): the opposite edge stays put, the points are scaled linearly,
 * the result never leaves the page and never collapses below `INK_MIN_RESIZE_EXTENT`. The pen width is
 * untouched. Returns null when the stroke cannot be resized.
 */
export function resizeInkPaths(
  paths: readonly (readonly InkPoint[])[],
  penWidth: number,
  handle: InkResizeHandle,
  pointer: InkPoint,
  heightRatio: number,
): InkPoint[][] | null {
  if (!canResizeInk(paths, heightRatio)) return null
  const b = pointBounds(paths)!
  const pad = penWidth / 2 + INK_OUTLINE_MARGIN
  const padY = pad / heightRatio
  const minW = INK_MIN_RESIZE_EXTENT
  const minH = INK_MIN_RESIZE_EXTENT / heightRatio
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
  let { minX, maxX, minY, maxY } = b
  if (handle.includes('w')) minX = Math.min(clamp01(pointer[0] + pad), maxX - minW)
  if (handle.includes('e')) maxX = Math.max(clamp01(pointer[0] - pad), minX + minW)
  if (handle.includes('n')) minY = Math.min(clamp01(pointer[1] + padY), maxY - minH)
  if (handle.includes('s')) maxY = Math.max(clamp01(pointer[1] - padY), minY + minH)
  // The edge clamps above can push the fixed edge only when the box is already at the page border.
  minX = clamp01(minX)
  maxX = clamp01(maxX)
  minY = clamp01(minY)
  maxY = clamp01(maxY)
  const sx = (maxX - minX) / (b.maxX - b.minX)
  const sy = (maxY - minY) / (b.maxY - b.minY)
  const round = (v: number) => Math.round(clamp01(v) * 1e5) / 1e5
  return paths.map((path) => path.map(([x, y]): InkPoint => [round(minX + (x - b.minX) * sx), round(minY + (y - b.minY) * sy)]))
}

/** Where a handle sits on a box, normalized page units. */
export function inkHandlePosition(box: InkBox, handle: InkResizeHandle): InkPoint {
  const x = handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.width : box.x + box.width / 2
  const y = handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.height : box.y + box.height / 2
  return [x, y]
}

/** Room the compact toolbar needs above the box (px); under it otherwise. */
export const INK_TOOLBAR_CLEARANCE_PX = 48

/** Which side of the selection the compact toolbar opens on: above, unless the box top is too near the page top. */
export function inkToolbarSide(boxTopPx: number): 'above' | 'below' {
  return boxTopPx >= INK_TOOLBAR_CLEARANCE_PX ? 'above' : 'below'
}
