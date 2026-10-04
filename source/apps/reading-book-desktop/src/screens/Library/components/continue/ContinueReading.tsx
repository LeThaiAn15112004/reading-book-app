import { formatRelativeLastRead, type LibraryBook } from '@reading-book/book-reader-sdk'
import { BookCover, BookMenuButton, type BookMenuPoint } from '../book'

export type ContinueReadingProps = {
  /** Books in progress, most recent first (`pickContinueReadingBooks`); parent omits when empty. */
  books: LibraryBook[]
  onResume: (bookId: string) => void
  onBookMenu: (bookId: string, point: BookMenuPoint) => void
}

/**
 * FR-08 — Continue Reading strip above the All books list. A shortcut to books in progress, not
 * a rail: at most a few cards that wrap; the full library is listed below.
 */
export function ContinueReading({ books, onResume, onBookMenu }: ContinueReadingProps) {
  return (
    <section className="mb-8" aria-labelledby="continue-title">
      <h2
        id="continue-title"
        className="m-0 mb-3 text-[11px] font-bold tracking-[0.14em] text-lib-faint uppercase"
      >
        Continue reading
      </h2>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-0">
        {books.map((book) => {
          const progress = book.progressPercent != null ? Math.round(book.progressPercent) : undefined
          const relative = formatRelativeLastRead(book.lastReadAt)
          return (
            <li
              key={book.id}
              className="group flex min-w-0 items-center gap-3.5 rounded-xl border border-lib-border-soft bg-lib-surface p-3 transition-colors hover:border-lib-accent-ring"
              onContextMenu={(event) => {
                event.preventDefault()
                onBookMenu(book.id, { x: event.clientX, y: event.clientY })
              }}
            >
              <button
                type="button"
                className="shrink-0 cursor-pointer border-none bg-transparent p-0"
                aria-label={`Resume ${book.title}`}
                onClick={() => onResume(book.id)}
              >
                <BookCover
                  bookId={book.id}
                  title={book.title}
                  coverUrl={book.coverUrl}
                  compact
                  className="h-[84px] w-[56px] rounded-md"
                  titleClassName="line-clamp-4 text-[9px] leading-tight font-semibold text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]"
                />
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="m-0 truncate text-[13px] font-semibold text-lib-text-strong" title={book.title}>
                  {book.title}
                </p>
                <p className="m-0 truncate text-[12px] text-lib-faint">{book.author}</p>
                <p className="m-0 truncate text-[11px] text-lib-muted">
                  {[book.lastReadLocation, relative].filter(Boolean).join(' · ')}
                </p>
                {progress !== undefined ? (
                  <span className="mt-1 flex items-center gap-2" aria-label={`${progress}% read`}>
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-lib-chip">
                      <span className="block h-full rounded-full bg-lib-accent" style={{ width: `${progress}%` }} />
                    </span>
                    <span className="text-[10px] text-lib-faint tabular-nums">{progress}%</span>
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <button
                  type="button"
                  className="inline-flex h-8 cursor-pointer items-center rounded-lg border-none bg-lib-accent px-3 text-[12px] font-semibold text-lib-bg-deep transition-colors hover:bg-lib-accent-hover"
                  onClick={() => onResume(book.id)}
                >
                  Resume
                </button>
                <BookMenuButton
                  title={book.title}
                  className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                  onOpen={(point) => onBookMenu(book.id, point)}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
