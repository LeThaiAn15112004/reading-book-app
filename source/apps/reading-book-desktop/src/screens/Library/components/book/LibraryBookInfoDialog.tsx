import { formatFileSizeMb } from '@reading-book/book-reader-sdk'
import { BookCover } from './BookCover'

export type LibraryBookInfoFields = {
  id: string
  title: string
  author?: string
  fileName?: string
  format?: string
  coverUrl?: string
  genre?: string
  genres?: string[]
  fileSizeBytes?: number
  pageCount?: number
  description?: string
}

export type LibraryBookInfoDialogProps = {
  open: boolean
  book: LibraryBookInfoFields | null
  onClose: () => void
}

/** SCR-01a — full book metadata dialog (G1-N7), including cover. */
export function LibraryBookInfoDialog({
  open,
  book,
  onClose,
}: LibraryBookInfoDialogProps) {
  if (!open || !book) return null

  const sizeLabel = formatFileSizeMb(book.fileSizeBytes) ?? '—'
  const pagesLabel =
    book.pageCount != null && book.pageCount > 0
      ? `${book.pageCount} ${book.pageCount === 1 ? 'page' : 'pages'}`
      : '—'
  const formatLabel = book.format?.trim().toUpperCase() || '—'
  const genreLabel =
    book.genre?.trim() ||
    (book.genres && book.genres.length > 0 ? book.genres.join(', ') : undefined) ||
    '—'

  const rows: Array<[string, string]> = [
    ['Title', book.title],
    ['Author', book.author?.trim() || '—'],
    ['Format', formatLabel],
    ['Genre', genreLabel],
    ['Size', sizeLabel],
    ['Pages', pagesLabel],
    ['File', book.fileName?.trim() || '—'],
    ['Description', book.description?.trim() || '—'],
  ]

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-lib-bg-deep/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[480px] flex-col gap-4 rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-xl"
        role="dialog"
        aria-labelledby="library-book-info-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="text-base font-semibold text-lib-text-strong"
          id="library-book-info-title"
        >
          Book info
        </div>

        <div className="flex gap-4">
          <BookCover
            bookId={book.id}
            title={book.title}
            coverUrl={book.coverUrl}
            format={formatLabel !== '—' ? formatLabel : undefined}
            className="h-[140px] w-[100px] shrink-0 rounded-md shadow-md"
            titleClassName="line-clamp-5 text-[10px] leading-snug font-semibold text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]"
          />
          <dl className="m-0 flex min-w-0 flex-1 flex-col gap-2.5">
            {rows
              .filter(([k]) => k !== 'Description')
              .map(([k, v]) => (
                <div key={k} className="grid grid-cols-[72px_1fr] gap-2 text-[13px]">
                  <dt className="m-0 font-semibold text-lib-faint">{k}</dt>
                  <dd className="m-0 break-words text-lib-text-strong">{v}</dd>
                </div>
              ))}
          </dl>
        </div>

        <div className="text-[13px]">
          <div className="mb-1 font-semibold text-lib-faint">Description</div>
          <p className="m-0 whitespace-pre-wrap break-words text-lib-text-strong">
            {book.description?.trim() || '—'}
          </p>
        </div>

        <div className="flex justify-end">
          <button
            className="h-10 cursor-pointer rounded-lg border border-lib-accent bg-lib-accent px-4 text-[13px] font-semibold text-lib-on-accent"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
