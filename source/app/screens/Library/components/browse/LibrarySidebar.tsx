import {
  LIBRARY_BROWSE_FILTERS,
  type LibraryBrowseFilter,
} from '../../logic/libraryBrowse'

const ICON_PATHS: Record<LibraryBrowseFilter, string> = {
  all: 'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25',
  reading: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  'not-started': 'M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z',
  completed: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  favorites: 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z',
}

export type LibrarySidebarProps = {
  active: LibraryBrowseFilter
  counts: Record<LibraryBrowseFilter, number>
  onSelect: (filter: LibraryBrowseFilter) => void
}

/**
 * SCR-01 Library sidebar: status filters + Favorites. Collections stay in the top navigation.
 * Narrow windows (< 900px) show icons only (label via tooltip + aria-label).
 */
export function LibrarySidebar({ active, counts, onSelect }: LibrarySidebarProps) {
  return (
    <aside
      className="flex w-[208px] shrink-0 flex-col border-r border-lib-border-soft bg-lib-topbar max-[900px]:w-[60px]"
      aria-label="Library filters"
    >
      <nav className="app-scroll min-h-0 flex-1 overflow-y-auto p-2 pt-3">
        <p className="m-0 mb-1.5 px-3 text-[11px] font-bold tracking-wide text-lib-faint uppercase max-[900px]:hidden">
          Library
        </p>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {LIBRARY_BROWSE_FILTERS.map((item) => {
            const selected = item.id === active
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`relative flex h-9 w-full cursor-pointer items-center gap-3 rounded-lg border-none px-3 text-left text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent max-[900px]:justify-center max-[900px]:px-0 ${
                    selected
                      ? 'bg-lib-accent-soft text-lib-accent'
                      : 'bg-transparent text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong'
                  }`}
                  title={item.label}
                  aria-label={`${item.label}, ${counts[item.id] === 1 ? '1 book' : `${counts[item.id]} books`}`}
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <svg
                    className="size-[18px] shrink-0"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.6}
                    stroke="currentColor"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={ICON_PATHS[item.id]} />
                  </svg>
                  <span className="min-w-0 flex-1 truncate max-[900px]:hidden">{item.label}</span>
                  <span
                    className={`text-[11px] tabular-nums max-[900px]:hidden ${
                      selected ? 'text-lib-accent' : 'text-lib-faint'
                    }`}
                  >
                    {counts[item.id]}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}
