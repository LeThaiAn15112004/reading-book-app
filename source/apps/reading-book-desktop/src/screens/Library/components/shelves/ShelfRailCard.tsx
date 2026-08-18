import { formatLastReadLine, type LibraryBook } from '@reading-book/shared/models'
import { BookCover, BookMenuButton, type BookMenuPoint } from '../book'

export type ShelfRailCardProps = {
  book: LibraryBook
  onOpen: (bookId: string) => void
  onBookMenu: (bookId: string, point: BookMenuPoint) => void
}

/** SCR-01 hub — one cover card in a shelf horizontal rail. */
export function ShelfRailCard({ book, onOpen, onBookMenu }: ShelfRailCardProps) {
  const lastReadLine =
    book.status === 'reading' && book.lastReadLocation
      ? formatLastReadLine(book.lastReadLocation)
      : undefined

  return (
    <div
      role="listitem"
      className="group relative flex w-[132px] shrink-0 flex-col gap-2"
      onContextMenu={(event) => {
        event.preventDefault()
        onBookMenu(book.id, { x: event.clientX, y: event.clientY })
      }}
    >
      <button
        type="button"
        className="flex cursor-pointer flex-col gap-2 border-none bg-transparent p-0 text-left font-[inherit] text-inherit focus-visible:outline-none"
        onClick={() => onOpen(book.id)}
        aria-label={`Open ${book.title}`}
      >
        <BookCover
          bookId={book.id}
          title={book.title}
          coverUrl={book.coverUrl}
          isFavorite={book.isFavorite}
          className="h-[180px] w-full rounded-md shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition-[border-color,transform] group-hover:-translate-y-0.5 group-hover:border-lib-accent-ring group-focus-visible:-translate-y-0.5 group-focus-visible:border-lib-accent-ring"
        />
        <div className="min-w-0 px-0.5">
          <p className="m-0 truncate text-[12px] font-semibold text-lib-text-strong">
            {book.title}
          </p>
          <p className="m-0 truncate text-[11px] text-lib-faint">{book.author}</p>
          {lastReadLine && book.lastReadLocation ? (
            <p className="m-0 truncate text-[11px] text-lib-muted" aria-label={lastReadLine}>
              Last at · <strong className="font-semibold text-lib-text-strong">{book.lastReadLocation}</strong>
            </p>
          ) : null}
        </div>
      </button>
      <div className="mt-auto flex min-h-9 items-center justify-between gap-2 px-0.5">
        <span className="inline-flex rounded bg-lib-chip px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-lib-muted uppercase">
          {book.format}
        </span>
        <BookMenuButton
          title={book.title}
          className="shrink-0 opacity-75 group-hover:opacity-100 focus-visible:opacity-100"
          onOpen={(point) => onBookMenu(book.id, point)}
        />
      </div>
    </div>
  )
}
