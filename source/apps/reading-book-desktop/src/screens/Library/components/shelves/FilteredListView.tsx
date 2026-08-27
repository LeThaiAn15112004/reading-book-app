import {
  ShelfDetailItem,
  type ShelfDetailItemData,
} from './ShelfDetailItem'
import { ShelfRailCard } from './ShelfRailCard'
import { ViewModeToggle, type ViewMode } from './ViewModeToggle'
import type { BookMenuPoint } from '../book'

export type FilteredListViewProps = {
  title: string
  emptyMessage: string
  items: ShelfDetailItemData[]
  onOpenItem: (id: string) => void
  onBookMenu: (id: string, point: BookMenuPoint) => void
  viewMode?: ViewMode
  onViewModeChange?: (mode: ViewMode) => void
}

/** SCR-01 nav filter list — Favorites / Completed / To read / Recent Books */
export function FilteredListView({
  title,
  emptyMessage,
  items,
  onOpenItem,
  onBookMenu,
  viewMode = 'grid',
  onViewModeChange,
}: FilteredListViewProps) {
  const sub =
    items.length === 1 ? '1 book' : `${items.length} books`

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      role="region"
      aria-label={title}
    >
      <header className="app-titlebar flex h-16 shrink-0 items-center gap-3 border-b border-lib-border-soft bg-lib-topbar pr-5 pl-7 backdrop-blur-sm">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 truncate text-lg leading-tight font-semibold tracking-tight text-lib-text-strong">
            {title}
          </h1>
          <p className="m-0 mt-0.5 text-xs text-lib-faint">{sub}</p>
        </div>
        {onViewModeChange ? (
          <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />
        ) : null}
      </header>

      <div className="flex-1 overflow-x-hidden overflow-y-auto px-5 pt-4 pb-8">
        {items.length > 0 ? (
          viewMode === 'list' ? (
            <ul
              className="mx-auto m-0 flex w-full max-w-[720px] list-none flex-col gap-2.5 p-0"
              role="list"
            >
              {items.map((item) => (
                <ShelfDetailItem
                  key={item.id}
                  item={item}
                  onOpen={onOpenItem}
                  onBookMenu={onBookMenu}
                />
              ))}
            </ul>
          ) : (
            <div
              className="mx-auto m-0 flex w-full max-w-[1180px] flex-wrap gap-5 p-0"
              role="list"
            >
              {items.map((item) => (
                <div key={item.id} className="w-[132px]">
                  <ShelfRailCard
                    book={item as any}
                    onOpen={onOpenItem}
                    onBookMenu={onBookMenu}
                  />
                </div>
              ))}
            </div>
          )
        ) : (
          <p className="m-0 text-center text-[13px] text-lib-faint">
            {emptyMessage}
          </p>
        )}
      </div>
    </div>
  )
}
