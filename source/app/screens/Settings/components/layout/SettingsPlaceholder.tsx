import { useT } from '../../../../i18n'

/** Content for Settings sections that exist in the sidebar but are not built yet. */
export function SettingsPlaceholder() {
  const t = useT()
  return (
    <div className="rounded-xl border border-dashed border-lib-border p-[var(--ui-density-pad)] text-center">
      <p className="m-0 text-sm text-lib-muted">{t('settings.placeholder')}</p>
    </div>
  )
}
