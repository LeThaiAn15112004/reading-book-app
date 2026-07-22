import {
  formatRelativeLastRead,
  type LibraryBook,
} from '../libraryModel'

const COVER_GRADS = [
  'linear-gradient(135deg, #1e3a8a, #3b82f6)',
  'linear-gradient(135deg, #064e3b, #10b981)',
  'linear-gradient(135deg, #7c2d12, #f97316)',
  'linear-gradient(135deg, #581c87, #8b5cf6)',
  'linear-gradient(135deg, #831843, #ec4899)',
] as const

function coverGrad(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i)) % 5
  return COVER_GRADS[hash % 5]
}

export type ContinueReadingProps = {
  book: LibraryBook
  onResume: (bookId: string) => void
  onOpenNotes?: (bookId: string) => void
}

/**
 * FR-08 / T1.7 — Continue Reading card.
 * Parent must omit this block when there is no `last_read` (empty library or never opened).
 */
export function ContinueReading({
  book,
  onResume,
  onOpenNotes,
}: ContinueReadingProps) {
  const formatBadge = book.format.trim().toUpperCase()
  const relative = formatRelativeLastRead(book.lastReadAt)
  const notesLabel =
    book.noteCount > 0 ? `Notes (${book.noteCount})` : 'Notes'

  return (
    <section className="mb-7" aria-labelledby="continue-title">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <h2
          id="continue-title"
          className="m-0 text-xs font-bold tracking-[0.14em] text-lib-faint uppercase"
        >
          Continue reading
        </h2>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-5 rounded-xl border border-lib-border bg-lib-surface p-5 backdrop-blur-[6px]">
        <div className="flex min-w-0 flex-1 items-center gap-5">
          <div
            className="flex h-[100px] w-[72px] shrink-0 items-center justify-center rounded-md border border-lib-accent-ring p-2.5 text-center shadow-[0_12px_32px_rgba(0,0,0,0.35)]"
            style={{ background: coverGrad(book.id) }}
            aria-hidden
          >
            <span className="line-clamp-4 text-[11px] leading-snug font-semibold text-lib-text [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]">
              {book.title}
            </span>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 className="m-0 truncate text-lg font-semibold tracking-tight text-lib-text-strong">
              {book.title}
            </h3>
            <p className="m-0 truncate text-sm text-lib-muted">{book.author}</p>
            <p className="m-0 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-lib-accent bg-lib-accent-soft">
                {formatBadge}
              </span>
              <span className="truncate font-mono text-lib-faint">
                {book.fileName}
              </span>
            </p>
            {relative ? (
              <p className="m-0 text-[12px] text-lib-muted">
                Last read · {relative}
              </p>
            ) : null}
            {book.lastReadLocation ? (
              <p
                className="m-0 text-[12px] text-lib-muted"
                aria-label="Last read location"
              >
                Last at ·{' '}
                <strong className="font-semibold text-lib-text-strong">
                  {book.lastReadLocation}
                </strong>
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          <button
            type="button"
            className="inline-flex h-[38px] cursor-pointer items-center rounded-lg border-none bg-lib-accent px-4 text-[13px] font-semibold text-lib-bg-deep shadow-[0_4px_14px_rgba(245,158,11,0.22)] transition-colors hover:bg-lib-accent-hover"
            onClick={() => onResume(book.id)}
          >
            Resume
          </button>
          <button
            type="button"
            className="inline-flex h-[38px] cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-medium text-lib-muted transition-colors hover:border-lib-accent-ring hover:text-lib-text-strong"
            onClick={() => onOpenNotes?.(book.id)}
          >
            {notesLabel}
          </button>
        </div>
      </div>
    </section>
  )
}
