import { useT } from '../../../i18n'
import { LIBRARY_SORTS, type LibraryLayout, type LibrarySortId } from '../logic'

export type PhoneBrowseToolbarProps = {
  count: number
  sort: LibrarySortId
  onSortChange: (sort: LibrarySortId) => void
  /** Stored layout: `table` is the phone List (FR-013). */
  layout: LibraryLayout
  onLayoutChange: (layout: LibraryLayout) => void
  /** Hide the sort control: the Recent chip has its own order (most recently read first, FR-032). */
  sortHidden?: boolean
}

const GRID_ICON =
  'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z'
const LIST_ICON = 'M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm0 5.25h.007v.008H3.75V12Zm0 5.25h.007v.008H3.75v-.008Z'

/**
 * Phone browse toolbar (spec 013, contracts/phone-library-ui.md region 4): "N books" · sort · Grid / List. The choice
 * goes through the shared browse store, so it is remembered and reset by Reset App Settings (FR-012).
 */
export function PhoneBrowseToolbar({ count, sort, onSortChange, layout, onLayoutChange, sortHidden = false }: PhoneBrowseToolbarProps) {
  const t = useT()
  const views: { id: LibraryLayout; label: string; icon: string }[] = [
    { id: 'grid', label: t('library.phone.layout.grid'), icon: GRID_ICON },
    { id: 'table', label: t('library.phone.layout.list'), icon: LIST_ICON },
  ]
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="shrink-0 text-[13px] text-lib-faint tabular-nums">{t('library.phone.bookCount', { count })}</span>
      {sortHidden ? (
        <span className="flex-1" />
      ) : (
        <label className="flex min-w-0 flex-1 items-center">
          <span className="sr-only">{t('library.sorts.label')}</span>
          <select
            className="h-11 min-w-0 max-w-full cursor-pointer truncate border-none bg-transparent pr-1 text-[13px] font-medium text-lib-text-strong outline-none"
            value={sort}
            onChange={(event) => onSortChange(event.target.value as LibrarySortId)}
          >
            {LIBRARY_SORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex shrink-0 rounded-lg border border-lib-border-soft p-0.5" role="group" aria-label={t('library.phone.layout.aria')}>
        {views.map((view) => {
          const pressed = layout === view.id
          return (
            <button
              key={view.id}
              type="button"
              aria-pressed={pressed}
              aria-label={view.label}
              title={view.label}
              className={`inline-flex size-10 cursor-pointer items-center justify-center rounded-md border-none transition-colors ${
                pressed ? 'bg-lib-accent-soft text-lib-accent' : 'bg-transparent text-lib-faint'
              }`}
              onClick={() => onLayoutChange(view.id)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="size-5" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d={view.icon} />
              </svg>
            </button>
          )
        })}
      </div>
    </div>
  )
}
