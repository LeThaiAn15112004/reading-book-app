/**
 * Desktop re-exports of platform-agnostic reader session types/helpers.
 * Demo signatures stay here (UI shell until book_signatures IPC).
 */
export {
  TOOL_LABELS,
  nextId,
  nextReaderOverlayId,
  type AnnotateTool,
  type ESignStamp,
  type HighlightColor,
  type PageLayout,
  type PageMode,
  type PendingSelection,
  type ReaderBookmark,
  type ReaderComment,
  type ReaderHighlight,
  type ReaderNote,
  type ReaderSignature,
  type TypewriterMark,
} from '@reading-book/shared/models'

export type { TextAlign } from '@reading-book/shared/models'

import type { ReaderSignature } from '@reading-book/shared/models'

/** Demo signatures for UI shell until detect/import fills `book_signatures`. */
export const FAKE_SIGNATURES: ReaderSignature[] = [
  {
    id: 'sig-demo-1',
    signerName: 'Nguyen Van A',
    signatureStatus: 'valid',
    signedAt: '2026-03-12T09:30:00.000Z',
  },
]
