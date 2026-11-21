/**
 * Phone select mode (long press a book) as the book grid / list sees it. Absent on Desktop: a long press / right
 * click there keeps opening the book menu.
 */
export type BookSelection = {
  /** At least one book is picked: a tap toggles instead of opening the book. */
  active: boolean
  isSelected: (bookId: string) => boolean
  /** Long press: starts select mode with this book, or toggles it while selecting. */
  onPress: (bookId: string) => void
  /** Tap while selecting. */
  onToggle: (bookId: string) => void
}
