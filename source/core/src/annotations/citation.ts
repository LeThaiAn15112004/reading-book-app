export interface CitationInput {
  text: string
  bookTitle: string
  author?: string
  /** Chapter / section label — reflowable EPUB has no fixed page number to cite. */
  locationLabel?: string
}

/**
 * `"<quoted text>"\n\n— <Book Title>, <Author> (<Chapter>)` for "Copy with citation". Omits the
 * author clause / parenthetical when unavailable instead of emitting dangling punctuation.
 */
export function formatCitation({ text, bookTitle, author, locationLabel }: CitationInput): string {
  const attribution = [bookTitle.trim(), author?.trim() || undefined].filter(Boolean).join(', ')
  const location = locationLabel?.trim() ? ` (${locationLabel.trim()})` : ''
  return `"${text.trim()}"\n\n— ${attribution}${location}`
}
