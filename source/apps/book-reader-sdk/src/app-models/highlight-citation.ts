/** Plain-text citation appended to a copied highlight quote ("Copy with Citation"). */

export type HighlightCitationInput = {
  text: string
  bookTitle: string
  author?: string
  /** Where the quote is from: EPUB chapter/section label (reflowable — no fixed page number), or a
   *  PDF page label ("p. 12" / "pp. 12–13"). */
  locationLabel?: string
}

/**
 * `"<quoted text>"
 *
 * — <Book Title>, <Author> (<Chapter label>)`
 *
 * Omits the author clause / location parenthetical when unavailable, rather than emitting
 * dangling punctuation.
 */
export function formatHighlightCitation({
  text,
  bookTitle,
  author,
  locationLabel,
}: HighlightCitationInput): string {
  const attribution = [bookTitle, author?.trim() || undefined].filter(Boolean).join(', ')
  const location = locationLabel?.trim() ? ` (${locationLabel.trim()})` : ''
  return `"${text.trim()}"\n\n— ${attribution}${location}`
}
