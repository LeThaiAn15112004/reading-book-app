import { continueAction, formatRelativeLastRead, type LibraryBook } from '@core'
import { useT, useUiLanguage } from '../../../i18n'
import { withLongPress } from '../../../platforms/longPress'
import { BookCover, BookMenuButton, type BookMenuPoint } from '../components'

export type PhoneContinueCarouselProps = {
  /** `pickPhoneContinueReading` (≤ 10, newest first). The carousel renders nothing when empty (FR-001). */
  books: LibraryBook[]
  onResume: (bookId: string) => void
  onReadAgain: (bookId: string) => void
  onBookMenu: (bookId: string, point: BookMenuPoint) => void
}

/**
 * Continue Reading on the phone (spec 013 US1, contracts/phone-library-ui.md region 3): a horizontal, snapping row of
 * cards; the next card peeks so the row reads as swipeable. A tap on the cover or the action opens the book straight in
 * the Reader — "Resume" at the saved place, "Read again" at the beginning (FR-003) — never a details popup first.
 */
export function PhoneContinueCarousel({ books, onResume, onReadAgain, onBookMenu }: PhoneContinueCarouselProps) {
  const t = useT()
  const language = useUiLanguage()
  if (books.length === 0) return null

  return (
    <section className="mb-6" aria-labelledby="phone-continue-title">
      <h2 id="phone-continue-title" className="m-0 mb-3 text-[15px] font-semibold text-lib-text-strong">
        {t('library.continue.title')}
      </h2>
      <ul className="phone-hscroll m-0 list-none gap-3 py-0.5">
        {books.map((book) => {
          const action = continueAction(book)
          const run = () => (action === 'read-again' ? onReadAgain(book.id) : onResume(book.id))
          const progress = action === 'read-again' && book.progressPercent == null ? 100 : Math.round(book.progressPercent ?? 0)
          const relative = formatRelativeLastRead(book.lastReadAt, language)
          const actionLabel = action === 'read-again' ? t('library.continue.readAgain') : t('library.continue.resume')
          return (
            <li
              key={book.id}
              className="phone-card flex w-[78vw] max-w-[340px] flex-col gap-3 rounded-2xl border border-lib-border-soft bg-lib-surface p-3.5"
              {...withLongPress((event) => {
                event.preventDefault()
                onBookMenu(book.id, { x: event.clientX, y: event.clientY })
              })}
            >
              <div className="flex min-w-0 items-start gap-3">
                <button
                  type="button"
                  className="shrink-0 cursor-pointer border-none bg-transparent p-0"
                  aria-label={`${actionLabel} — ${book.title}`}
                  onClick={run}
                >
                  <BookCover
                    bookId={book.id}
                    title={book.title}
                    coverUrl={book.coverUrl}
                    compact
                    className="h-[72px] w-[48px] rounded-md"
                    titleClassName="line-clamp-4 text-[9px] leading-tight font-semibold text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]"
                  />
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="m-0 truncate text-[14px] font-semibold text-lib-text-strong" title={book.title}>
                    {book.title}
                  </p>
                  <p className="m-0 truncate text-[12px] text-lib-faint">{book.author}</p>
                  <p className="m-0 truncate text-[12px] text-lib-muted">
                    {[book.lastReadLocation, relative].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <BookMenuButton title={book.title} className="!size-11 -mt-1 -mr-1" onOpen={(point) => onBookMenu(book.id, point)} />
              </div>
              <div className="flex items-center gap-3">
                <span
                  className="flex min-w-0 flex-1 items-center gap-2"
                  aria-label={t('library.continue.percentRead', { percent: progress })}
                >
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-lib-chip">
                    <span className="block h-full rounded-full bg-lib-accent" style={{ width: `${progress}%` }} />
                  </span>
                  <span className="text-[11px] text-lib-faint tabular-nums">{progress}%</span>
                </span>
                <button
                  type="button"
                  className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-lg px-4 text-[13px] font-semibold transition-colors ${
                    action === 'read-again'
                      ? 'border border-lib-accent bg-transparent text-lib-accent active:bg-lib-accent-soft'
                      : 'border-none bg-lib-accent text-lib-bg-deep active:bg-lib-accent-hover'
                  }`}
                  onClick={run}
                >
                  {actionLabel}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
