import { Fragment, type ReactNode } from 'react'
import type { LibraryBook } from '@core'
import { useT } from '../../../../i18n'
import type { BookMenuPoint } from '../book'
import { ShelfRailCard } from '../shelves/ShelfRailCard'
import type { BookSelection } from './bookSelection'

export type LibraryBookGridProps = {
  books: LibraryBook[]
  onOpen: (bookId: string) => void
  onBookMenu: (bookId: string, point: BookMenuPoint) => void
  /** Extra classes on the grid, e.g. `phone-grid` (spec 013: phone column rule in styles/phone.css). */
  className?: string
  /** Spec 016: drawn after the first `leadCount` books, in the same grid (the import placeholders). */
  inserted?: ReactNode
  leadCount?: number
  /** Phone select mode (see `BookSelection`). */
  selection?: BookSelection
}

/**
 * Main Library grid: every book in the current filter, wrapping into as many columns as fit
 * (no horizontal rail, vertical scroll only).
 */
export function LibraryBookGrid({ books, onOpen, onBookMenu, className, inserted, leadCount = 0, selection }: LibraryBookGridProps) {
  const t = useT()
  // One keyed array, so a book keeps its card (and cover) when the placeholders move or go away.
  const slot = inserted ? <Fragment key="import-placeholders">{inserted}</Fragment> : null
  const items: ReactNode[] = []
  books.forEach((book, index) => {
    if (index === leadCount) items.push(slot)
    items.push(
      <ShelfRailCard
        key={book.id}
        book={book}
        onOpen={onOpen}
        onBookMenu={onBookMenu}
        className={index < leadCount ? 'w-full import-arrived' : 'w-full'}
        selection={selection}
      />,
    )
  })
  if (leadCount >= books.length) items.push(slot)
  return (
    <div
      className={`grid grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-x-5 gap-y-6${className ? ` ${className}` : ''}`}
      role="list"
      aria-label={t('library.books')}
    >
      {items}
    </div>
  )
}
