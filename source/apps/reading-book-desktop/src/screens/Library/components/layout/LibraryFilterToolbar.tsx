import type { NavFilterId } from '@reading-book/shared/models'

export type LibraryFilterId = 'all' | NavFilterId
export type LibraryViewMode = 'grid' | 'list'

type LibraryFilterToolbarProps = {
  activeFilter: LibraryFilterId
  onFilterChange: (filter: LibraryFilterId) => void
}

function HeartIcon({ className, solid }: { className?: string; solid?: boolean }) {
  if (solid) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden
      >
        <path d="m11.645 20.91-.007-.003-.022-.012a15.247 15.247 0 0 1-.383-.218 25.18 25.18 0 0 1-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0 1 12 5.052 5.5 5.5 0 0 1 16.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 0 1-4.244 3.17 15.247 15.247 0 0 1-.383.219l-.022.012-.007.004-.003.001a.752.752 0 0 1-.704 0l-.003-.001Z" />
      </svg>
    )
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"
      />
    </svg>
  )
}

const STATUS_FILTERS: { id: LibraryFilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'reading', label: 'Recent Books' },
  { id: 'to-read', label: 'To read' },
  { id: 'completed', label: 'Completed' },
]

export function LibraryFilterToolbar({
  activeFilter,
  onFilterChange,
}: LibraryFilterToolbarProps) {
  return (
    <div className="flex h-12 w-full shrink-0 items-center border-b border-lib-border-soft bg-lib-bg/50 px-4 backdrop-blur-sm sm:px-7">
      <div className="flex items-center gap-1.5 overflow-x-auto" role="tablist" aria-label="Library Filters">
        <button
          type="button"
          role="tab"
          aria-selected={activeFilter === 'favorites'}
          onClick={() => onFilterChange('favorites')}
          className={`group flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
            activeFilter === 'favorites'
              ? 'bg-[#E33B58]/10 text-[#E33B58]'
              : 'bg-lib-chip/50 text-lib-muted hover:bg-lib-chip hover:text-lib-text-strong'
          }`}
        >
          <HeartIcon
            className={`size-3.5 transition-transform group-hover:scale-110 group-active:scale-95 ${activeFilter === 'favorites' ? 'text-[#E33B58]' : ''}`}
            solid={activeFilter === 'favorites'}
          />
          Favorites
        </button>

        <span className="mx-1 h-3 w-px shrink-0 bg-lib-border" aria-hidden />

        {STATUS_FILTERS.map((filter) => {
          const active = activeFilter === filter.id
          return (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onFilterChange(filter.id)}
              className={`flex h-7 shrink-0 items-center rounded-full px-3 text-xs font-medium transition-colors ${
                active
                  ? 'bg-lib-text-strong text-lib-bg-deep'
                  : 'bg-transparent text-lib-muted hover:bg-lib-chip/50 hover:text-lib-text-strong'
              }`}
            >
              {filter.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
