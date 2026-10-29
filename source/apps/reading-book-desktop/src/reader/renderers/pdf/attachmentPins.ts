/**
 * A file attachment on a PDF page, drawn by Readmate (specs/007-pdf-file-attachment research R9): one paperclip
 * icon per attachment, whoever made it, so it is always visible and the same everywhere; the file's own
 * appearance on the canvas is hidden while the displayed file is the scanned one.
 */
export type PdfAttachmentPin = {
  /** Row id (Readmate-made) or attachment id (another reader's). */
  id: string
  pageIndex: number
  /** Icon box, normalised 0–1 to the displayed page. */
  box: { x: number; y: number; width: number; height: number }
  name: string
  sizeBytes: number | null
  /** Readmate-made: can be moved and deleted. Another reader's: open / save only. */
  editable: boolean
}

/** The pin under a normalised page point (topmost = last drawn), or null. */
export function attachmentPinAt(pins: readonly PdfAttachmentPin[], x: number, y: number): PdfAttachmentPin | null {
  for (let i = pins.length - 1; i >= 0; i--) {
    const { box } = pins[i]!
    if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) return pins[i]!
  }
  return null
}
