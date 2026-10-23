/**
 * In-memory Reader session shapes (platform-agnostic) not tied to annotations/bookmarks.
 * Annotation/bookmark overlay shapes were removed pending a rebuild directly against
 * `notes`/`INoteState` (see `packages/domain/models/annotation/note.ts`).
 */

export type PageLayout = 'single' | 'dual'

/**
 * Cursor / pointer mode for the reading surface (always one active).
 * - hand: browse — I-beam over text after hover dwell (native select/copy), grab/pan on margins
 * - select: text-selection focused (I-beam immediately); margin pan without changing toolbar
 * - highlight / underline / strikethrough / squiggly / replace / insert: same native-selection gesture as `select` (no margin
 *   pan) but a drag-to-select that ends on a non-collapsed selection instantly marks it with the
 *   tool's style — see `useReaderHighlights`'s `onTextSelected` branch. Sticky: stays active
 *   across multiple marks until the toolbar button is clicked again, another tool is picked, or
 *   Escape.
 */
export type InteractionTool =
  | 'hand'
  | 'select'
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'squiggly'
  | 'replace'
  | 'insert'
  /** Freehand Ink pen (PDF only, capability `inkAnnotations`): a drag draws a stroke; never a text selection. */
  | 'pen'
  /** Stroke Eraser (PDF only, capability `inkAnnotations`): a drag removes whole Readmate Ink strokes, nothing else. */
  | 'eraser'
  /** Shape tools (PDF only, capability `shapeAnnotations`): a drag draws a rectangle / ellipse / line / arrow annotation; never a text selection. */
  | 'shape'

/** The tools whose drag over text saves a mark in that style (the `HighlightStyleKind` of the same name). */
export const MARKUP_TOOLS = ['highlight', 'underline', 'squiggly', 'strikethrough', 'replace', 'insert'] as const
export type MarkupInteractionTool = (typeof MARKUP_TOOLS)[number]

export function isMarkupTool(tool: InteractionTool): tool is MarkupInteractionTool {
  return (MARKUP_TOOLS as readonly string[]).includes(tool)
}

/** Selection geometry in viewport coords (numbers only — no DOM nodes). */
export type ViewportRect = {
  top: number
  left: number
  width: number
  height: number
}
