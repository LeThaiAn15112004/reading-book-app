import {
  ShelfDetailItem,
  type ShelfDetailItemData,
} from './ShelfDetailItem'

export type FilteredListViewProps = {
  title: string
  emptyMessage: string
  items: ShelfDetailItemData[]
  onOpenItem: (id: string) => void
}

/** SCR-01 nav filter list — Favorites / Completed / To read (no Back; switch via sidebar). */
export function FilteredListView({
  title,
  emptyMessage,
  items,
  onOpenItem,
}: FilteredListViewProps) {
  const sub =
    items.length === 1 ? '1 book' : `${items.length} books`

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      role="region"
      aria-label={title}
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-lib-border-soft bg-lib-topbar px-7 backdrop-blur-sm">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 truncate text-lg leading-tight font-semibold tracking-tight text-lib-text-strong">
            {title}
          </h1>
          <p className="m-0 mt-0.5 text-xs text-lib-faint">{sub}</p>
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
