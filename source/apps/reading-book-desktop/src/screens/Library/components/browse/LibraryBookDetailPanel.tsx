import { useEffect } from 'react'
import type { LibraryBook } from '@reading-book/book-reader-sdk'
import { BookMenuButton, LibraryBookInfoContent, type BookMenuPoint } from '../book'

export type LibraryBookDetailPanelProps = {
  book: LibraryBook
  onClose: () => void
  onOpen: (bookId: string) => void
  onToggleFavorite: (book: LibraryBook) => void
  onBookMenu: (bookId: string, point: BookMenuPoint) => void
}

/**
 * Table-mode detail panel for the selected row. Metadata body is shared with the Book info dialog
 * (`LibraryBookInfoContent`); every action goes through the same Library handlers / book menu.
 */
export function LibraryBookDetailPanel({
  book,
  onClose,
  onOpen,
  onToggleFavorite,
  onBookMenu,
}: LibraryBookDetailPanelProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const progress =
    book.status === 'reading' && book.progressPercent != null
      ? Math.round(book.progressPercent)
      : undefined

  return (
    <aside
      className="flex w-[320px] shrink-0 flex-col border-l border-lib-border-soft bg-lib-surface-strong max-[1100px]:w-[280px]"
      aria-label={`Details for ${book.title}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-lib-border-soft px-4 py-2.5">
        <h2 className="m-0 min-w-0 truncate text-sm font-semibold text-lib-text-strong" title={book.title}>
          {book.title}
        </h2>
        <button
          type="button"
          className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-lib-muted transition-colors hover:bg-lib-surface-hover hover:text-lib-text-strong"
          title="Close details"
          aria-label="Close details"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="app-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-6">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center rounded-lg border-none bg-lib-accent px-4 text-[13px] font-semibold text-lib-bg-deep transition-colors hover:bg-lib-accent-hover"
            onClick={() => onOpen(book.id)}
          >
            {book.status === 'reading' ? 'Resume' : 'Read'}
          </button>
          <button
            type="button"
            className={`inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-lib-border bg-transparent text-[15px] transition-colors hover:border-lib-accent ${
              book.isFavorite ? 'text-lib-accent' : 'text-lib-muted'
            }`}
            title={book.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={book.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={book.isFavorite}
            onClick={() => onToggleFavorite(book)}
          >
            {book.isFavorite ? '★' : '☆'}
          </button>
          <BookMenuButton title={book.title} onOpen={(point) => onBookMenu(book.id, point)} />
        </div>

        {progress !== undefined ? (
          <div className="flex items-center gap-2 text-[12px] text-lib-muted">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-lib-chip">
              <span className="block h-full rounded-full bg-lib-accent" style={{ width: `${progress}%` }} />
            </span>
            <span className="tabular-nums">{progress}%</span>
            {book.lastReadLocation ? <span className="truncate">· {book.lastReadLocation}</span> : null}
          </div>
        ) : null}

        <LibraryBookInfoContent
          variant="panel"
          book={{
            id: book.id,
            title: book.title,
            author: book.author,
            fileName: book.fileName,
            format: book.format,
            coverUrl: book.coverUrl,
            genre: book.genre,
            genres: book.genres,
            fileSizeBytes: book.fileSizeBytes,
            pageCount: book.pageCount,
            description: book.description,
          }}
        />
      </div>
    </aside>
  )
}
