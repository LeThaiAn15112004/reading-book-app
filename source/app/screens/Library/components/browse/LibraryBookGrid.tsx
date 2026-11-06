import type { LibraryBook } from '@reading-book/book-reader-sdk'
import type { BookMenuPoint } from '../book'
import { ShelfRailCard } from '../shelves/ShelfRailCard'

export type LibraryBookGridProps = {
  books: LibraryBook[]
  onOpen: (bookId: string) => void
  onBookMenu: (bookId: string, point: BookMenuPoint) => void
}

/**
 * Main Library grid: every book in the current filter, wrapping into as many columns as fit
 * (no horizontal rail, vertical scroll only).
 */
export function LibraryBookGrid({ books, onOpen, onBookMenu }: LibraryBookGridProps) {
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-x-5 gap-y-6"
      role="list"
      aria-label="Books"
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
