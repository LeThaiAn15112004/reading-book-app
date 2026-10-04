import { formatLastReadLine, type LibraryBook } from '@reading-book/book-reader-sdk'
import { BookCover, BookMenuButton, type BookMenuPoint } from '../book'

const PROVIDER_LABEL: Record<'google_drive' | 'dropbox' | 'onedrive', string> = {
  google_drive: 'Google Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
}

function CloudBadgeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z"
      />
    </svg>
  )
}

export type ShelfRailCardProps = {
  book: LibraryBook
  onOpen: (bookId: string) => void
  onBookMenu: (bookId: string, point: BookMenuPoint) => void
  /** Width classes; default fixed 132px (collection grid). Library grid passes `w-full`. */
  className?: string
}

/** One cover card — Library grid cell and collection grid. */
export function ShelfRailCard({
  book,
  onOpen,
  onBookMenu,
  className = 'w-[132px] shrink-0',
}: ShelfRailCardProps) {
  const progress =
    book.status === 'reading' && book.progressPercent != null
      ? Math.round(book.progressPercent)
      : undefined
  const lastReadLine =
    progress === undefined && book.status === 'reading' && book.lastReadLocation
      ? formatLastReadLine(book.lastReadLocation)
      : undefined

  return (
    <div
      role="listitem"
      className={`group relative flex min-w-0 flex-col gap-2 ${className}`}
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
          className="aspect-[2/3] h-auto w-full rounded-md shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition-[border-color,transform] group-hover:-translate-y-0.5 group-hover:border-lib-accent-ring group-focus-visible:-translate-y-0.5 group-focus-visible:border-lib-accent-ring"
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
          {progress !== undefined ? (
            <div
              className="mt-1.5 flex items-center gap-1.5"
              role="progressbar"
              aria-label={`${progress}% read`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-lib-chip">
                <span className="block h-full rounded-full bg-lib-accent" style={{ width: `${progress}%` }} />
              </span>
              <span className="text-[10px] text-lib-faint tabular-nums">{progress}%</span>
            </div>
          ) : null}
        </div>
      </button>
      <div className="mt-auto flex min-h-9 items-center justify-between gap-2 px-0.5">
        <span className="inline-flex items-center gap-1 rounded bg-lib-chip px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-lib-muted uppercase">
          {book.format}
          {book.sourceProvider ? (
            <span title={`Synced from ${PROVIDER_LABEL[book.sourceProvider]}`}>
              <CloudBadgeIcon className="size-2.5" />
            </span>
          ) : null}
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
