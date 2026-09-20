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
 * - highlight / underline / strikethrough: same native-selection gesture as `select` (no margin
 *   pan) but a drag-to-select that ends on a non-collapsed selection instantly marks it with the
 *   tool's style — see `useReaderHighlights`'s `onTextSelected` branch. Sticky: stays active
 *   across multiple marks until the toolbar button is clicked again, another tool is picked, or
 *   Escape.
 */
export type InteractionTool = 'hand' | 'select' | 'highlight' | 'underline' | 'strikethrough'

/** Selection geometry in viewport coords (numbers only — no DOM nodes). */
export type ViewportRect = {
  top: number
  left: number
  width: number
  height: number
}

export type ReaderSignature = {
  id: string
  signerName: string
  signatureStatus: 'valid' | 'invalid' | 'expired' | 'unknown'
  signedAt?: string
}
