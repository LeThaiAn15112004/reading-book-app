import { BookCover } from './BookCover'

export type ShelfDetailItemData = {
  id: string
  title: string
  author?: string
  fileName?: string
  /** Display format (e.g. EPUB); shown as cover badge. */
  format?: string
  /** Renderer-safe cover URL when available. */
  coverUrl?: string
  /** Progress chip or last-read line (G4 fills real location). */
  progressLabel?: string
  progressKind?: 'chip' | 'last'
  progressDone?: boolean
  isFavorite?: boolean
  /** Stable cover gradient 1–5; omit → hash from id. */
  coverGradientIndex?: 1 | 2 | 3 | 4 | 5
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m8.25 4.5 7.5 7.5-7.5 7.5"
      />
    </svg>
  )
}

export type ShelfDetailItemProps = {
  item: ShelfDetailItemData
  onOpen: (id: string) => void
}

/** One SCR-01a vertical row: cover · meta · progress · › */
export function ShelfDetailItem({ item, onOpen }: ShelfDetailItemProps) {
  const formatBadge = item.format?.trim().toUpperCase()
  const progressKind = item.progressKind ?? (item.progressLabel ? 'chip' : undefined)

  return (
    <li>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-3.5 rounded-[10px] border border-lib-border bg-lib-surface p-3 text-left font-[inherit] text-inherit transition-[border-color,background-color,transform] hover:-translate-y-px hover:border-lib-accent-ring hover:bg-[rgb(30_41_59/0.55)] focus-visible:border-lib-accent-ring focus-visible:outline-none"
        onClick={() => onOpen(item.id)}
      >
        <BookCover
          bookId={item.id}
          title={item.title}
          coverUrl={item.coverUrl}
          format={formatBadge}
          isFavorite={item.isFavorite}
          compact
          className="h-[72px] w-[52px] shrink-0 rounded-[5px]"
          titleClassName="line-clamp-4 text-[9px] leading-tight font-semibold text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="m-0 truncate text-[13px] leading-snug font-semibold text-lib-text-strong">
            {item.title}
          </h3>
          {item.author ? (
            <p className="m-0 truncate text-[11px] text-lib-faint">{item.author}</p>
          ) : null}
          {item.fileName ? (
            <p className="m-0 truncate font-mono text-[11px] text-lib-faint">
              {item.fileName}
            </p>
          ) : null}
          {item.progressLabel && progressKind === 'last' ? (
            <p className="m-0 text-[11px] text-lib-muted">{item.progressLabel}</p>
          ) : null}
          {item.progressLabel && progressKind === 'chip' ? (
            <div className="mt-0.5">
              <span
                className={
                  item.progressDone
                    ? 'inline-flex rounded-md bg-lib-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-lib-accent'
                    : 'inline-flex rounded-md bg-lib-chip px-1.5 py-0.5 text-[10px] font-medium text-lib-muted'
                }
              >
                {item.progressLabel}
              </span>
            </div>
          ) : null}
        </div>

        <span className="flex shrink-0 items-center justify-center text-lib-faint">
          <ChevronIcon className="size-5" />
        </span>
      </button>
    </li>
  )
}
