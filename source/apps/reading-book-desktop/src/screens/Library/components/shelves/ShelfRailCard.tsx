import { formatLastReadLine, type LibraryBook } from '@reading-book/shared/models'
import { BookCover } from '../book/BookCover'

export type ShelfRailCardProps = {
  book: LibraryBook
  onOpen: (bookId: string) => void
}

/** SCR-01 hub — one cover card in a shelf horizontal rail. */
export function ShelfRailCard({ book, onOpen }: ShelfRailCardProps) {
  const lastReadLine =
    book.status === 'reading' && book.lastReadLocation
      ? formatLastReadLine(book.lastReadLocation)
      : undefined

  return (
    <button
      type="button"
      role="listitem"
      className="group flex w-[132px] shrink-0 cursor-pointer flex-col gap-2 border-none bg-transparent p-0 text-left font-[inherit] text-inherit focus-visible:outline-none"
      onClick={() => onOpen(book.id)}
      aria-label={`Open ${book.title}`}
    >
      <BookCover
        bookId={book.id}
        title={book.title}
        coverUrl={book.coverUrl}
        format={book.format}
        isFavorite={book.isFavorite}
        className="h-[180px] w-full rounded-md shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition-[border-color,transform] group-hover:-translate-y-0.5 group-hover:border-lib-accent-ring group-focus-visible:-translate-y-0.5 group-focus-visible:border-lib-accent-ring"
      />
      <div className="min-w-0 px-0.5">
        <p className="m-0 truncate text-[12px] font-semibold text-lib-text-strong">
          {book.title}
        </p>
        <p className="m-0 truncate text-[11px] text-lib-faint">{book.author}</p>
        {lastReadLine && book.lastReadLocation ? (
          <p
            className="m-0 truncate text-[11px] text-lib-muted"
            aria-label={lastReadLine}
          >
            Last at ·{' '}
            <strong className="font-semibold text-lib-text-strong">
              {book.lastReadLocation}
            </strong>
          </p>
        ) : null}
      </div>
    </button>
  )
}
