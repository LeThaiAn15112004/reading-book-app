import { useT } from '../../../i18n'
import { CloseIcon } from '../components/book/LibraryIcons'

export type PhoneSelectionBarProps = {
  count: number
  allSelected: boolean
  onClose: () => void
  onToggleAll: () => void
}

/**
 * Replaces the Library header while books are selected (long press): ✕ leaves select mode, the count is announced
 * politely as it changes, "Select all" picks every book shown (it becomes "Deselect all").
 */
export function PhoneSelectionBar({ count, allSelected, onClose, onToggleAll }: PhoneSelectionBarProps) {
  const t = useT()
  return (
    <div className="flex min-h-12 items-center gap-2 px-2">
      <button
        type="button"
        className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-lib-text-strong active:bg-lib-chip"
        aria-label={t('library.selection.close')}
        onClick={onClose}
      >
        <CloseIcon className="size-6" />
      </button>
      <p className="m-0 min-w-0 flex-1 truncate text-[17px] font-semibold text-lib-text-strong" role="status" aria-live="polite">
        {t('library.selection.count', { count })}
      </p>
      <button
        type="button"
        className="inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-lg border-none bg-transparent px-3 text-sm font-semibold text-lib-accent active:bg-lib-chip"
        onClick={onToggleAll}
      >
        {allSelected ? t('library.selection.deselectAll') : t('library.selection.selectAll')}
      </button>
    </div>
  )
}
