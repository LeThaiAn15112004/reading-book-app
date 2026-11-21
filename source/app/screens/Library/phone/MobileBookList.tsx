import { Fragment, type ReactNode } from 'react'
import { listRowProgress, type LibraryBook } from '@core'
import { useT } from '../../../i18n'
import { withLongPress } from '../../../platforms/longPress'
import { BookCover, BookMenuButton, type BookMenuPoint, type BookSelection } from '../components'
import { SelectionMark } from '../components/book/LibraryIcons'

export type MobileBookListProps = {
  books: LibraryBook[]
  onOpen: (bookId: string) => void
  onBookMenu: (bookId: string, point: BookMenuPoint) => void
  /** Spec 016: list items drawn after the first `leadCount` books (the import placeholders). */
  inserted?: ReactNode
  leadCount?: number
  /** Select mode (long press a row). */
  selection?: BookSelection
}

/**
 * Phone List view (spec 013 FR-011; the stored layout `table`): one 80 px row per book — cover thumbnail, title, author,
 * a thin progress bar under the author line once the book has been opened (inside the same height), the format badge
 * and ⋮. A tap opens the book; ⋮ or a long press opens the bottom sheet.
 */
export function MobileBookList({ books, onOpen, onBookMenu, inserted, leadCount = 0, selection }: MobileBookListProps) {
  const t = useT()
  const selecting = selection?.active ?? false
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('library.books')}>
      {leadCount === 0 ? inserted : null}
      {books.map((book, index) => {
        const progress = listRowProgress(book)
        const selected = selection?.isSelected(book.id) ?? false
        return (
          <Fragment key={book.id}>
          <li
            className={`phone-row${index < leadCount ? ' import-arrived' : ''} flex h-20 items-center gap-3 rounded-xl border pr-1 pl-2 ${
              selected ? 'border-lib-accent bg-lib-accent-soft' : 'border-lib-border-soft bg-lib-surface'
            }`}
            {...withLongPress((event) => {
              event.preventDefault()
              if (selection) selection.onPress(book.id)
              else onBookMenu(book.id, { x: event.clientX, y: event.clientY })
            })}
          >
            <button
              type="button"
              className="relative flex h-full min-w-0 flex-1 cursor-pointer items-center gap-3 border-none bg-transparent p-0 text-left"
              onClick={() => (selecting ? selection!.onToggle(book.id) : onOpen(book.id))}
              aria-label={selecting ? t('library.selection.selectBook', { title: book.title }) : undefined}
              aria-pressed={selecting ? selected : undefined}
            >
              {selecting ? <SelectionMark selected={selected} className="absolute top-1/2 left-3 z-[1] -translate-y-1/2" /> : null}
              <BookCover
                bookId={book.id}
                title={book.title}
                coverUrl={book.coverUrl}
                compact
                className="h-16 w-12 shrink-0 rounded-md"
                titleClassName="line-clamp-3 text-[8px] leading-tight font-semibold text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[14px] font-semibold text-lib-text-strong" title={book.title}>
                  {book.title}
                </span>
                <span className="truncate text-[12px] text-lib-faint">{book.author}</span>
                {progress !== undefined ? (
                  <span
                    className="mt-1 block h-1 w-full max-w-40 overflow-hidden rounded-full bg-lib-chip"
                    aria-label={t('library.continue.percentRead', { percent: progress })}
                  >
                    <span className="block h-full rounded-full bg-lib-accent" style={{ width: `${progress}%` }} />
                  </span>
                ) : null}
              </span>
            </button>
            <span className="shrink-0 rounded-md border border-lib-border-soft px-2 py-0.5 text-[10px] font-bold tracking-wide text-lib-muted uppercase">
              {book.format}
            </span>
            <BookMenuButton title={book.title} className={`!size-11${selecting ? ' invisible' : ''}`} onOpen={(point) => onBookMenu(book.id, point)} />
          </li>
          {leadCount > 0 && index === leadCount - 1 ? inserted : null}
          </Fragment>
        )
      })}
    </ul>
  )
}
