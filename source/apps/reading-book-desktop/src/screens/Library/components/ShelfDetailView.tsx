import {
  ShelfDetailItem,
  type ShelfDetailItemData,
} from './ShelfDetailItem'

function BackIcon({ className }: { className?: string }) {
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
        d="M15.75 19.5 8.25 12l7.5-7.5"
      />
    </svg>
  )
}

export type ShelfDetailViewProps = {
  title: string
  items: ShelfDetailItemData[]
  onBack: () => void
  onOpenItem: (id: string) => void
  /** Override subtitle (default: “N files”). */
  countLabel?: string
  emptyMessage?: string
  backAriaLabel?: string
}

/** SCR-01a — shelf detail: Back · title · N files + vertical list. */
export function ShelfDetailView({
  title,
  items,
  onBack,
  onOpenItem,
  countLabel,
  emptyMessage = 'No files in this section.',
  backAriaLabel = 'Back to library',
}: ShelfDetailViewProps) {
  const fileLabel =
    countLabel ?? (items.length === 1 ? '1 file' : `${items.length} files`)

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      id="shelfDetailView"
      role="region"
      aria-label={`${title} shelf`}
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-lib-border-soft bg-lib-topbar px-5 backdrop-blur-sm">
        <button
          type="button"
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-lib-muted transition-[color,background-color] hover:bg-white/5 hover:text-lib-accent focus-visible:bg-white/5 focus-visible:text-lib-accent focus-visible:outline-none"
          aria-label={backAriaLabel}
          title="Back"
          onClick={onBack}
        >
          <BackIcon className="size-6" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 truncate text-lg leading-tight font-semibold tracking-tight text-lib-text-strong">
            {title}
          </h1>
          <p className="m-0 mt-0.5 text-xs text-lib-faint">{fileLabel}</p>
        </div>
      </header>

      <div className="flex-1 overflow-x-hidden overflow-y-auto px-5 pt-4 pb-8">
        {items.length > 0 ? (
          <ul
            className="mx-auto m-0 flex w-full max-w-[720px] list-none flex-col gap-2.5 p-0"
            role="list"
          >
            {items.map((item) => (
              <ShelfDetailItem key={item.id} item={item} onOpen={onOpenItem} />
            ))}
          </ul>
        ) : (
          <p className="m-0 text-center text-[13px] text-lib-faint">
            {emptyMessage}
          </p>
        )}
      </div>
    </div>
  )
}
