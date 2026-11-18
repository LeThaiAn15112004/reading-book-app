import type { CollectionCoverSlot, LibraryBook } from '@core'
import { BookCover } from '../book/BookCover'

export type CollectionCoversProps = {
  slots: readonly CollectionCoverSlot[]
  booksById: ReadonlyMap<string, LibraryBook>
  /** `card`: three covers side by side (Desktop card); `stack`: three small overlapping covers (phone row). */
  variant: 'card' | 'stack'
}

const tinyTitle =
  'line-clamp-3 text-[7px] leading-tight font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]'

/**
 * The first books of a collection (spec 015 US3, FR-012): the same `BookCover` the Library shows (image, else the
 * Library's generated cover), theme-coloured empty places. Decorative: the name and count say what the card is.
 */
export function CollectionCovers({ slots, booksById, variant }: CollectionCoversProps) {
  if (variant === 'card') {
    return (
      <div className="grid h-[96px] w-full grid-cols-3 gap-1.5" aria-hidden>
        {slots.map((slot, i) => {
          const book = slot.kind === 'book' ? booksById.get(slot.bookId) : undefined
          return book ? (
            <BookCover
              key={book.id}
              bookId={book.id}
              title={book.title}
              coverUrl={book.coverUrl}
              compact
              className="h-full w-full rounded-md"
              titleClassName={tinyTitle}
            />
          ) : (
            <span key={`empty-${i}`} className="rounded-md bg-lib-chip" />
          )
        })}
      </div>
    )
  }
  return (
    <div className="flex h-14 w-[72px] shrink-0 items-center" aria-hidden>
      {slots.map((slot, i) => {
        const book = slot.kind === 'book' ? booksById.get(slot.bookId) : undefined
        const place = `h-14 w-10 shrink-0 rounded-[5px] shadow-sm ${i > 0 ? '-ml-6' : ''}`
        return book ? (
          <BookCover
            key={book.id}
            bookId={book.id}
            title={book.title}
            coverUrl={book.coverUrl}
            compact
            className={place}
            titleClassName={tinyTitle}
          />
        ) : (
          <span key={`empty-${i}`} className={`${place} border border-lib-border-soft bg-lib-chip`} />
        )
      })}
    </div>
  )
}
