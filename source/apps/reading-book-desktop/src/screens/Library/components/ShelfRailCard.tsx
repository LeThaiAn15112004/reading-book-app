import type { LibraryBook } from '../libraryModel'

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

export type ShelfRailCardProps = {
  book: LibraryBook
  onOpen: (bookId: string) => void
}

/** SCR-01 hub — one cover card in a shelf horizontal rail. */
export function ShelfRailCard({ book, onOpen }: ShelfRailCardProps) {
  const formatBadge = book.format.trim().toUpperCase()

  return (
    <button
      type="button"
      role="listitem"
      className="group flex w-[132px] shrink-0 cursor-pointer flex-col gap-2 border-none bg-transparent p-0 text-left font-[inherit] text-inherit focus-visible:outline-none"
      onClick={() => onOpen(book.id)}
      aria-label={`Open ${book.title}`}
    >
      <div
        className="relative flex h-[180px] w-full items-end overflow-hidden rounded-md border border-lib-border p-2.5 shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition-[border-color,transform] group-hover:-translate-y-0.5 group-hover:border-lib-accent-ring group-focus-visible:-translate-y-0.5 group-focus-visible:border-lib-accent-ring"
        style={{ background: coverGrad(book.id) }}
        aria-hidden
      >
        <span className="absolute top-1.5 right-1.5 rounded px-1 py-px text-[8px] font-bold tracking-wide text-white/90 bg-black/45">
          {formatBadge}
        </span>
        {book.isFavorite ? (
          <span className="absolute top-1.5 left-1.5 text-[11px] text-lib-accent [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
            ★
          </span>
        ) : null}
        <span className="line-clamp-4 text-[11px] leading-snug font-semibold text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]">
          {book.title}
        </span>
      </div>
      <div className="min-w-0 px-0.5">
        <p className="m-0 truncate text-[12px] font-semibold text-lib-text-strong">
          {book.title}
        </p>
        <p className="m-0 truncate text-[11px] text-lib-faint">{book.author}</p>
      </div>
    </button>
  )
}
