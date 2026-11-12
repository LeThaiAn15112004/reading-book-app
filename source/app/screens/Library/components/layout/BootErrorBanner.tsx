import { useT } from '../../../../i18n'

type BootErrorBannerProps = {
  message: string
  onRetry: () => void
}

/** Shown when Splash → Library arrives with a boot probe failure. */
export function BootErrorBanner({ message, onRetry }: BootErrorBannerProps) {
  const t = useT()
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-3 border-l-2 border-lib-accent bg-lib-accent-soft px-3 py-2 text-sm text-lib-text"
      role="alert"
    >
      <p className="min-w-0 flex-1 text-lib-text-strong/90">
        {t('library.boot.failed', { detail: message || t('library.boot.fallback') })}
      </p>
      <button
        type="button"
        className="shrink-0 cursor-pointer border-none bg-transparent text-lib-accent underline [-webkit-app-region:no-drag]"
        onClick={onRetry}
      >
        {t('common.actions.retry')}
      </button>
    </div>
  )
}
