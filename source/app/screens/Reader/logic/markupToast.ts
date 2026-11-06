import type { MarkupInteractionTool } from '@reading-book/book-reader-sdk'

const DONE: Record<MarkupInteractionTool, string> = {
  highlight: 'Highlighted',
  underline: 'Underlined',
  squiggly: 'Squiggly underlined',
  strikethrough: 'Struck through',
  replace: 'Marked for replacement — add the new text as a note',
  insert: 'Marked for insertion — add the text to insert as a note',
}

/** Toast after a markup tool saved a mark. */
export function markupToast(tool: MarkupInteractionTool): string {
  return `${DONE[tool]} — Ctrl+Z to undo`
}
