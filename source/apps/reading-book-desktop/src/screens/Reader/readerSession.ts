/** In-memory Reader session + overlays (UI shell). Persistence lands later. */

export type AnnotateTool =
  | 'note'
  | 'highlight'
  | 'comment'
  | 'typewriter'
  | 'esign'
  | null

export type HighlightColor = 'yellow' | 'green' | 'pink'

export type PageLayout = 'single' | 'dual'
export type PageMode = 'scroll' | 'paginated'
export type TextAlign = 'left' | 'justify' | 'center'

export type ReaderHighlight = {
  id: string
  chapterIndex: number
  paragraphIndex: number
  selectedText: string
  color: HighlightColor
}

export type ReaderNote = {
  id: string
  chapterIndex: number
  paragraphIndex: number
  selectedText: string
  content: string
}

export type ReaderBookmark = {
  id: string
  chapterIndex: number
  label: string
}

export type ReaderComment = {
  id: string
  chapterIndex: number
  paragraphIndex: number
  content: string
  authorName: string
  createdAt: string
}

export type TypewriterMark = {
  id: string
  chapterIndex: number
  xPct: number
  yPct: number
  text: string
}

export type ESignStamp = {
  id: string
  chapterIndex: number
  xPct: number
  yPct: number
  label: string
}

export type ReaderSignature = {
  id: string
  signerName: string
  signatureStatus: 'valid' | 'invalid' | 'expired' | 'unknown'
  signedAt?: string
}

export type PendingSelection = {
  chapterIndex: number
  paragraphIndex: number
  selectedText: string
  rect: { top: number; left: number; width: number; height: number }
}

let seq = 0
export function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

export const TOOL_LABELS: Record<Exclude<AnnotateTool, null>, string> = {
  note: 'Note',
  highlight: 'Highlight',
  comment: 'Comment',
  typewriter: 'Typewriter',
  esign: 'eSign',
}

export const FAKE_SIGNATURES: ReaderSignature[] = [
  {
    id: 'sig-demo-1',
    signerName: 'Nguyen Van A',
    signatureStatus: 'valid',
    signedAt: '2026-03-12T09:30:00.000Z',
  },
]
