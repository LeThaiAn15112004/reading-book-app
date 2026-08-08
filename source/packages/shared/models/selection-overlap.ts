import { cfiRangesOverlap } from '../utils/epub-cfi.js'
import type { PendingSelection, ReaderHighlight } from './reader-session.js'

export function selectionHasHighlight(
  selection: PendingSelection,
  highlights: ReaderHighlight[],
): boolean {
  if (selection.source === 'epub') {
    return highlights.some(
      (h) =>
        h.source === 'epub' && cfiRangesOverlap(h.cfiRange, selection.cfiRange),
    )
  }
  return highlights.some(
    (h) =>
      h.source === 'fake' &&
      h.chapterIndex === selection.chapterIndex &&
      h.paragraphIndex === selection.paragraphIndex,
  )
}

export function findOverlappingHighlight(
  selection: PendingSelection,
  highlights: ReaderHighlight[],
): ReaderHighlight | undefined {
  if (selection.source === 'epub') {
    return highlights.find(
      (h) =>
        h.source === 'epub' && cfiRangesOverlap(h.cfiRange, selection.cfiRange),
    )
  }
  return highlights.find(
    (h) =>
      h.source === 'fake' &&
      h.chapterIndex === selection.chapterIndex &&
      h.paragraphIndex === selection.paragraphIndex,
  )
}
