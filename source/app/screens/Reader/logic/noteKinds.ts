import type { HighlightStyleKind } from '@reading-book/book-reader-sdk'

/**
 * Markup whose text lives in the note and so opens the comment editor right after it is made:
 * a plain `textbox` note, and `replace` (the note holds the text that replaces the struck-out one).
 */
export function opensNotePopup(styleKind: HighlightStyleKind): boolean {
  return styleKind === 'textbox' || styleKind === 'replace'
}
