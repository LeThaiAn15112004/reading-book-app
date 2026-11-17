import { useT } from '../../../i18n'

export type PhoneSettingsHeaderProps = {
  title: string
  /** Section pages only: the back control (spec 014 FR-004). The list page has no back control. */
  onBack?: () => void
}

function ChevronLeftIcon() {
  return (
    <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  )
}

/** Phone Settings header (spec 014, contract §3): never scrolls; title truncates; 48 × 48 back control. */
export function PhoneSettingsHeader({ title, onBack }: PhoneSettingsHeaderProps) {
  const t = useT()
  return (
    <header
      className={`flex min-h-14 shrink-0 items-center gap-1 border-b border-lib-border-soft bg-lib-bg-deep ${
        onBack ? 'pr-4 pl-1' : 'px-4'
      }`}
    >
      {onBack ? (
        <button
          type="button"
          className="inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border-none bg-transparent text-lib-text-strong transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent active:bg-lib-surface-hover"
          aria-label={t('settings.phone.back')}
          onClick={onBack}
        >
          <ChevronLeftIcon />
        </button>
      ) : null}
      <h1 className="m-0 min-w-0 truncate text-lg font-semibold tracking-tight text-lib-text-strong">{title}</h1>
    </header>
  )
}
