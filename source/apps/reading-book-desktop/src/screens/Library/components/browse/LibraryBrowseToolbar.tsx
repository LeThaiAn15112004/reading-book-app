import {
  LIBRARY_SORTS,
  type LibraryLayout,
  type LibrarySortId,
} from '../../logic/libraryBrowse'

export type LibraryBrowseToolbarProps = {
  title: string
  count: number
  sort: LibrarySortId
  onSortChange: (sort: LibrarySortId) => void
  layout: LibraryLayout
  onLayoutChange: (layout: LibraryLayout) => void
}

function GridIcon() {
  return (
    <svg className="size-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
    </svg>
  )
}

function TableIcon() {
  return (
    <svg className="size-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0 1 12 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 1.5v-1.5m0 0c0-.621.504-1.125 1.125-1.125m0 0h7.5" />
    </svg>
  )
}

const LAYOUTS: readonly { id: LibraryLayout; label: string; icon: () => JSX.Element }[] = [
  { id: 'grid', label: 'Grid view', icon: GridIcon },
  { id: 'table', label: 'Table view', icon: TableIcon },
]

/** Heading of the browse area: current filter + count, Sort and Grid ⇄ Table (both remembered). */
export function LibraryBrowseToolbar({
  title,
  count,
  sort,
  onSortChange,
  layout,
  onLayoutChange,
}: LibraryBrowseToolbarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h2 className="m-0 truncate text-lg font-semibold tracking-tight text-lib-text-strong">
          {title}
        </h2>
        <span className="text-[13px] text-lib-faint tabular-nums">
          {count === 1 ? '1 book' : `${count} books`}
        </span>
      </div>

      <label className="flex items-center gap-2 text-[12px] text-lib-muted">
        <span>Sort</span>
        <select
          className="h-8 cursor-pointer rounded-lg border border-lib-border bg-lib-input px-2.5 text-[13px] text-lib-text-strong outline-none focus:border-lib-accent"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as LibrarySortId)}
        >
          {LIBRARY_SORTS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div
        className="inline-flex overflow-hidden rounded-lg border border-lib-border"
        role="group"
        aria-label="Layout"
      >
        {LAYOUTS.map(({ id, label, icon: Icon }) => {
          const selected = layout === id
          return (
            <button
              key={id}
              type="button"
              className={`inline-flex h-8 w-9 cursor-pointer items-center justify-center border-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent ${
                selected
                  ? 'bg-lib-accent-soft text-lib-accent'
                  : 'bg-transparent text-lib-muted hover:text-lib-text-strong'
              }`}
              title={label}
              aria-label={label}
              aria-pressed={selected}
              onClick={() => onLayoutChange(id)}
            >
              <Icon />
            </button>
          )
        })}
      </div>
    </div>
  )
}
