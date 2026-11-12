import type { LibraryBook } from '@core'
import { useT } from '../../../../i18n'
import type { BookMenuPoint } from '../book'
import { ShelfRailCard } from '../shelves/ShelfRailCard'

export type LibraryBookGridProps = {
  books: LibraryBook[]
  onOpen: (bookId: string) => void
  onBookMenu: (bookId: string, point: BookMenuPoint) => void
  /** Extra classes on the grid, e.g. `phone-grid` (spec 013: phone column rule in styles/phone.css). */
  className?: string
}

/**
 * Main Library grid: every book in the current filter, wrapping into as many columns as fit
 * (no horizontal rail, vertical scroll only).
 */
export function LibraryBookGrid({ books, onOpen, onBookMenu, className }: LibraryBookGridProps) {
  const t = useT()
  return (
    <div
      className={`grid grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-x-5 gap-y-6${className ? ` ${className}` : ''}`}
      role="list"
      aria-label={t('library.books')}
    >
      {books.map((book) => (
        <ShelfRailCard
          key={book.id}
          book={book}
          onOpen={onOpen}
          onBookMenu={onBookMenu}
          className="w-full"
        />
      ))}
    </div>
  )
}
