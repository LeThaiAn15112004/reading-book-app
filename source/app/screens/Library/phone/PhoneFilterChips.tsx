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
            // 36 px pill; the `before:` layer extends the button's own hit area 4 px above and below to 44 px (FR-027)
            // — the row's padding alone would not, it is not part of the button.
            className={`relative inline-flex h-9 cursor-pointer before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']  items-center rounded-full border px-4 text-[13px] font-medium whitespace-nowrap transition-colors ${
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
