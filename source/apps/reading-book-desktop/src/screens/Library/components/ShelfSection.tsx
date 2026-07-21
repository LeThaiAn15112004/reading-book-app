export type ShelfId = 'reading' | 'completed' | 'not-started'

function DragHandleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 9h16.5m-16.5 6h16.5"
      />
    </svg>
  )
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
        d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
      />
    </svg>
  )
}

type ShelfSectionProps = {
  id: ShelfId
  title: string
  fileCount: number
  onOpen?: (id: ShelfId) => void
}

/** One SCR-01 shelf: header (= · title · N files · ›) + horizontal rail (empty OK). */
export function ShelfSection({ id, title, fileCount, onOpen }: ShelfSectionProps) {
  const titleId = `shelf-${id}`
  const fileLabel = fileCount === 1 ? '1 file' : `${fileCount} files`
  const isEmpty = fileCount === 0

  return (
    <section className="mb-8" data-shelf={id} aria-labelledby={titleId}>
      <div className="mb-3 flex min-h-10 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex size-9 shrink-0 cursor-grab items-center justify-center rounded-lg border-none bg-transparent text-lib-faint transition-colors hover:bg-white/5 hover:text-lib-accent active:cursor-grabbing"
            aria-label={`Drag to reorder ${title} section`}
            title="Drag to reorder"
          >
            <DragHandleIcon className="size-5" />
          </button>
          <h2
            id={titleId}
            className="m-0 text-lg font-semibold tracking-tight text-lib-text-strong"
          >
            {title}
          </h2>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="text-[13px] font-medium text-lib-faint">{fileLabel}</span>
          <button
            type="button"
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-lib-muted transition-[color,background-color,transform] hover:translate-x-0.5 hover:bg-white/5 hover:text-lib-accent"
            aria-label={`View ${title} list`}
            title="View list"
            onClick={() => onOpen?.(id)}
          >
            <ChevronIcon className="size-5" />
          </button>
        </div>
      </div>

      {isEmpty ? (
        <p className="m-0 text-[13px] text-lib-faint">No files in this section.</p>
      ) : (
        <div className="flex gap-[18px] overflow-x-auto overflow-y-hidden" role="list" />
      )}
    </section>
  )
}
