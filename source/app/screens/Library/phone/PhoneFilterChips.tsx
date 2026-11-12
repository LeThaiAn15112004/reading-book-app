import { PHONE_LIBRARY_CHIPS, toPhoneChip, type PhoneChipId } from '@core'
import { useT } from '../../../i18n'
import type { LibraryBrowseFilter } from '../logic'

export type PhoneFilterChipsProps = {
  /** The browse store's filter; desktop-only filters are shown as All (`toPhoneChip`). */
  filter: LibraryBrowseFilter
  onChange: (chip: PhoneChipId) => void
}

/**
 * Phone filter chips (spec 013 FR-030 / FR-031): All · Recent · Saved · Completed, one active at a time, in a row that
 * scrolls sideways when the labels do not fit (longer languages, large text).
 */
export function PhoneFilterChips({ filter, onChange }: PhoneFilterChipsProps) {
  const t = useT()
  const active = toPhoneChip(filter)
  return (
    <div className="phone-hscroll gap-2 py-1" role="radiogroup" aria-label={t('library.phone.chips.aria')}>
      {PHONE_LIBRARY_CHIPS.map((chip) => {
        const checked = chip.id === active
        return (
          <button
            key={chip.id}
            type="button"
            role="radio"
            aria-checked={checked}
            // 36 px pill; the 4 px vertical padding of the row brings the touch area to 44 px.
            className={`inline-flex h-9 cursor-pointer items-center rounded-full border px-4 text-[13px] font-medium whitespace-nowrap transition-colors ${
              checked
                ? 'border-lib-accent bg-lib-accent-soft text-lib-accent'
                : 'border-lib-border-soft bg-lib-surface text-lib-muted active:bg-lib-chip'
            }`}
            onClick={() => onChange(chip.id)}
          >
            {t(chip.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
