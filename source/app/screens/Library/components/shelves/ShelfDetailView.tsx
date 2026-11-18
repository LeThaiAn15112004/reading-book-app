import type { ReactNode } from 'react'
import { useT } from '../../../../i18n'
import { isMobileHost } from '../../../../platforms/host'
import {
  ShelfDetailItem,
  type ShelfDetailItemData,
} from './ShelfDetailItem'
import { ShelfRailCard } from './ShelfRailCard'
import { ViewModeToggle, type ViewMode } from './ViewModeToggle'
import type { BookMenuPoint } from '../book'

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
  /** Shown in full under the title (collection page, spec 015 Edge Cases / FR-013). */
  description?: string
  items: ShelfDetailItemData[]
  onBack: () => void
  onOpenItem: (id: string) => void
  onBookMenu: (id: string, point: BookMenuPoint) => void
  /** Override subtitle (default: “N files”). */
  countLabel?: string
  emptyMessage?: string
  /** Replaces the plain empty text when given (collection page: text + "Add books"). */
  emptyState?: ReactNode
  /** Extra header controls, rendered before the Grid / List toggle (collection page: Add books + ⋮). */
  headerActions?: ReactNode
  backAriaLabel?: string
  viewMode?: ViewMode
  onViewModeChange?: (mode: ViewMode) => void
}

/** SCR-01a — shelf/collection detail: Back · title (+ description) · N files · actions · Grid/List toggle. */
export function ShelfDetailView({
  title,
  description,
  items,
  onBack,
  onOpenItem,
  onBookMenu,
  countLabel,
  emptyMessage,
  emptyState,
  headerActions,
  backAriaLabel,
  viewMode = 'list',
  onViewModeChange,
}: ShelfDetailViewProps) {
  const t = useT()
  const phone = isMobileHost()
  const fileLabel = countLabel ?? t('library.fileCount', { count: items.length })

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      id="shelfDetailView"
      role="region"
      aria-label={t('library.shelf.region', { title })}
    >
      <header
        className={`app-titlebar flex min-h-16 shrink-0 items-center border-b border-lib-border-soft bg-lib-topbar py-2 backdrop-blur-sm ${
          phone ? 'flex-wrap gap-x-2 gap-y-1 pr-3 pl-1' : 'gap-3 pr-5 pl-5'
        }`}
      >
        <button
          type="button"
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-lib-muted transition-[color,background-color] hover:bg-lib-surface-hover hover:text-lib-accent focus-visible:bg-lib-surface-hover focus-visible:text-lib-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent"
          aria-label={backAriaLabel ?? t('library.shelf.backToLibrary')}
          title={t('library.shelf.back')}
          onClick={onBack}
        >
          <BackIcon className="size-6" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-lg leading-tight font-semibold tracking-tight break-words text-lib-text-strong">
            {title}
          </h1>
          {description ? (
            <p className="m-0 mt-0.5 text-[13px] leading-snug break-words text-lib-muted">{description}</p>
          ) : null}
          <p className="m-0 mt-0.5 text-xs text-lib-muted">{fileLabel}</p>
        </div>
        {/* Phone (360 px): the actions take their own row, so the name keeps the full width (FR-005: 8 px apart). */}
        <div className={`flex shrink-0 items-center ${phone ? 'w-full justify-end gap-2' : 'gap-3'}`}>
          {headerActions}
          {onViewModeChange ? (
            <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-x-hidden overflow-y-auto px-4 pt-4 pb-8 sm:px-5">
        {items.length > 0 ? (
          viewMode === 'grid' ? (
            // FR-022: columns fill the width evenly from 320 px up (no ragged gap, no sideways scroll).
            <div
              className="mx-auto m-0 grid w-full max-w-[1180px] grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-4 p-0 sm:grid-cols-[repeat(auto-fill,minmax(132px,1fr))] sm:gap-5"
              role="list"
            >
              {items.map((item) => (
                <div key={item.id} className="min-w-0">
                  <ShelfRailCard
                    className="w-full min-w-0"
                    book={item}
                    onOpen={onOpenItem}
                    onBookMenu={onBookMenu}
                  />
                </div>
              ))}
            </div>
          ) : (
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
          )
        ) : emptyState ? (
          emptyState
        ) : (
          <p className="m-0 text-center text-[13px] text-lib-muted">
            {emptyMessage ?? t('library.shelf.emptySection')}
          </p>
        )}
      </div>
    </div>
  )
}
