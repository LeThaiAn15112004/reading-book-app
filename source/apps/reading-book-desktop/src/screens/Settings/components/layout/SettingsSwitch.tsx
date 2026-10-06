/** ON/OFF switch used by Settings rows (Privacy, Notifications). Labelled by the row's own text. */
export function SettingsSwitch({
  checked,
  onChange,
  labelledBy,
  describedBy,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  labelledBy: string
  describedBy?: string
  /** E.g. while a check started by the last toggle is still running. */
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-busy={disabled || undefined}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-wait disabled:opacity-70 ${
        checked ? 'bg-lib-accent' : 'bg-lib-chip'
      }`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
        aria-hidden
      />
    </button>
  )
}
