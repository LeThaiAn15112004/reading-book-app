import { useRef, type KeyboardEvent } from 'react'
import { formatRelativeLastRead, type LibraryBook } from '@reading-book/book-reader-sdk'
import { BookCover, BookMenuButton, type BookMenuPoint } from '../book'

export type LibraryBookTableProps = {
  books: LibraryBook[]
  selectedBookId: string | null
  onSelect: (bookId: string) => void
  onOpen: (bookId: string) => void
  onBookMenu: (bookId: string, point: BookMenuPoint) => void
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

function formatAdded(iso?: string): string {
  if (!iso) return '—'
  const time = Date.parse(iso)
  return Number.isNaN(time) ? '—' : dateFormat.format(time)
}

function ProgressCell({ book }: { book: LibraryBook }) {
  if (book.status === 'completed') {
    return (
      <span className="inline-flex rounded-md bg-lib-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-lib-accent">
        Completed
      </span>
    )
  }
  if (book.status === 'reading') {
    if (book.progressPercent == null) {
      return <span className="text-[12px] text-lib-muted">In progress</span>
    }
    const value = Math.round(book.progressPercent)
    return (
      <span className="flex items-center gap-2" aria-label={`${value}% read`}>
        <span className="h-1 w-16 overflow-hidden rounded-full bg-lib-chip">
          <span className="block h-full rounded-full bg-lib-accent" style={{ width: `${value}%` }} />
        </span>
        <span className="text-[12px] text-lib-muted tabular-nums">{value}%</span>
      </span>
    )
  }
  return <span className="text-[12px] text-lib-faint">Not started</span>
}

const th =
  'sticky top-0 z-[1] border-b border-lib-border bg-lib-bg-deep px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-lib-faint uppercase'
const td = 'border-b border-lib-border-soft px-3 py-2 align-middle'

/**
 * Library table: dense rows for large document libraries. Click selects (detail panel),
 * double-click / Enter opens, ↑/↓ move the selection, right-click or ⋮ opens the book menu.
 * Lower-priority columns hide as the container narrows.
 */
export function LibraryBookTable({
  books,
  selectedBookId,
  onSelect,
  onOpen,
  onBookMenu,
}: LibraryBookTableProps) {
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())

  function moveSelection(fromIndex: number, delta: number) {
    const next = books[fromIndex + delta]
    if (!next) return
    onSelect(next.id)
    rowRefs.current.get(next.id)?.focus()
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, index: number, book: LibraryBook) {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpen(book.id)
    } else if (event.key === ' ') {
      event.preventDefault()
      onSelect(book.id)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveSelection(index, 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveSelection(index, -1)
    }
  }

  return (
    <div className="@container rounded-xl border border-lib-border-soft">
      <table className="w-full border-collapse text-[13px]" role="grid" aria-label="Books">
        <thead>
          <tr>
            <th className={`${th} w-[52px]`}>
              <span className="sr-only">Cover</span>
            </th>
            <th className={th}>Title</th>
            <th className={`${th} hidden w-[22%] @lg:table-cell`}>Author</th>
            <th className={`${th} w-[72px]`}>Format</th>
            <th className={`${th} hidden w-[132px] @md:table-cell`}>Progress</th>
            <th className={`${th} hidden w-[120px] @2xl:table-cell`}>Last read</th>
            <th className={`${th} hidden w-[120px] @3xl:table-cell`}>Added</th>
            <th className={`${th} w-[44px]`}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {books.map((book, index) => {
            const selected = book.id === selectedBookId
            return (
              <tr
                key={book.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(book.id, el)
                  else rowRefs.current.delete(book.id)
                }}
                tabIndex={0}
                aria-selected={selected}
                className={`group cursor-pointer outline-none transition-colors focus-visible:bg-lib-surface-hover ${
                  selected ? 'bg-lib-accent-soft' : 'hover:bg-lib-surface-hover'
                }`}
                onClick={() => onSelect(book.id)}
                onDoubleClick={() => onOpen(book.id)}
                onKeyDown={(e) => onRowKeyDown(e, index, book)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  onSelect(book.id)
                  onBookMenu(book.id, { x: event.clientX, y: event.clientY })
                }}
              >
                <td className={`${td} py-1.5`}>
                  <BookCover
                    bookId={book.id}
                    title={book.title}
                    coverUrl={book.coverUrl}
                    compact
                    className="h-[44px] w-[30px] rounded-[3px]"
                    titleClassName="hidden"
                  />
                </td>
                <td className={`${td} max-w-0`}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-semibold text-lib-text-strong" title={book.title}>
                      {book.title}
                    </span>
                    {book.isFavorite ? (
                      <span className="shrink-0 text-[11px] text-lib-accent" aria-label="Favorite">
                        ★
                      </span>
                    ) : null}
                  </div>
                  <p className="m-0 truncate text-[11px] text-lib-faint @lg:hidden">{book.author}</p>
                </td>
                <td className={`${td} hidden max-w-0 truncate text-lib-muted @lg:table-cell`}>
                  {book.author}
                </td>
                <td className={td}>
                  <span className="inline-flex rounded bg-lib-chip px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-lib-muted uppercase">
                    {book.format}
                  </span>
                </td>
                <td className={`${td} hidden @md:table-cell`}>
                  <ProgressCell book={book} />
                </td>
                <td className={`${td} hidden text-[12px] text-lib-muted @2xl:table-cell`}>
                  {formatRelativeLastRead(book.lastReadAt) ?? '—'}
                </td>
                <td className={`${td} hidden text-[12px] text-lib-muted @3xl:table-cell`}>
                  {formatAdded(book.addedAt)}
                </td>
                <td className={`${td} px-1`}>
                  <BookMenuButton
                    title={book.title}
                    className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                    onOpen={(point) => {
                      onSelect(book.id)
                      onBookMenu(book.id, point)
                    }}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
