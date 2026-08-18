import { formatFileSizeMb } from '@reading-book/shared/models'
import { BookCover, BookMenuButton, type BookMenuPoint } from '../book'

export type ShelfDetailItemData = {
  id: string
  title: string
  author?: string
  fileName?: string
  /** Display format (e.g. EPUB); shown as cover badge. */
  format?: string
  /** Renderer-safe cover URL when available. */
  coverUrl?: string
  fileSizeBytes?: number
  description?: string
  genre?: string
  genres?: string[]
  pageCount?: number
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

function buildMetaLine(item: ShelfDetailItemData): string | undefined {
  const parts: string[] = []
  const genreLabel =
    item.genre?.trim() ||
    (item.genres && item.genres.length > 0 ? item.genres.join(', ') : undefined)
  if (genreLabel) parts.push(genreLabel)
  const size = formatFileSizeMb(item.fileSizeBytes)
  if (size) parts.push(size)
  if (item.pageCount != null && item.pageCount > 0) {
    parts.push(
      `${item.pageCount} ${item.pageCount === 1 ? 'page' : 'pages'}`,
    )
  }
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export type ShelfDetailItemProps = {
  item: ShelfDetailItemData
  onOpen: (id: string) => void
  onBookMenu: (id: string, point: BookMenuPoint) => void
}

/** One SCR-01a vertical row: cover · meta · progress · ⋮ · › */
export function ShelfDetailItem({
  item,
  onOpen,
  onBookMenu,
}: ShelfDetailItemProps) {
  const formatBadge = item.format?.trim().toUpperCase()
  const progressKind =
    item.progressKind ?? (item.progressLabel ? 'chip' : undefined)
  const metaLine = buildMetaLine(item)
  const description = item.description?.trim()

  return (
    <li>
      <div
        className="group relative flex w-full items-center gap-3.5 rounded-[10px] border border-lib-border bg-lib-surface p-3 transition-[border-color,background-color,transform] hover:-translate-y-px hover:border-lib-accent-ring hover:bg-[rgb(30_41_59/0.55)] focus-within:border-lib-accent-ring"
        onContextMenu={(event) => {
          event.preventDefault()
          onBookMenu(item.id, { x: event.clientX, y: event.clientY })
        }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3.5 border-none bg-transparent p-0 text-left font-[inherit] text-inherit focus-visible:outline-none"
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
              <p className="m-0 truncate text-[11px] text-lib-faint">
                {item.author}
              </p>
            ) : null}
            {item.fileName ? (
              <p className="m-0 truncate font-mono text-[11px] text-lib-faint">
                {item.fileName}
              </p>
            ) : null}
            {metaLine ? (
              <p className="m-0 truncate text-[11px] text-lib-muted">
                {metaLine}
              </p>
            ) : null}
            {description ? (
              <p className="m-0 line-clamp-2 text-[11px] leading-snug text-lib-faint">
                {description}
              </p>
            ) : null}
            {item.progressLabel && progressKind === 'last' ? (
              <p className="m-0 text-[11px] text-lib-muted">
                {item.progressLabel}
              </p>
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
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <BookMenuButton
            title={item.title}
            className="opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
            onOpen={(point) => onBookMenu(item.id, point)}
          />

          <button
            type="button"
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-lib-faint transition-colors hover:text-lib-text-strong focus-visible:text-lib-text-strong focus-visible:outline-none"
            aria-label={`Open ${item.title}`}
            onClick={() => onOpen(item.id)}
          >
            <ChevronIcon className="size-5" />
          </button>
        </div>
      </div>
    </li>
  )
}
