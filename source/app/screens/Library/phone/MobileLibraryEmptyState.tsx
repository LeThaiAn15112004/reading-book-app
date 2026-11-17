import { useT } from '../../../i18n'

export type MobileLibraryEmptyStateProps = {
  onFromDevice: () => void
}

/**
 * First-launch empty Library on the phone (spec 013 US2, FR-007 / FR-008): icon, one sentence, the supported formats
 * and ONE primary action that opens the system file picker. No drag and drop, no URL or cloud import (not on Mobile).
 */
export function MobileLibraryEmptyState({ onFromDevice }: MobileLibraryEmptyStateProps) {
  const t = useT()
  return (
    <section
      className="flex min-h-full flex-col items-center justify-center px-4 py-12 text-center"
      aria-label={t('library.phone.empty.aria')}
    >
      <span className="mb-5 inline-flex size-20 items-center justify-center rounded-2xl bg-lib-accent-soft text-lib-accent">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.6}
          stroke="currentColor"
          className="size-10"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
          />
        </svg>
      </span>
      <h2 className="m-0 mb-2 text-lg font-semibold tracking-tight text-lib-text-strong">
        {t('library.phone.empty.title')}
      </h2>
      <p className="m-0 mb-3 max-w-xs text-sm leading-relaxed text-lib-muted">{t('library.phone.empty.body')}</p>
      <p className="m-0 mb-8 text-xs font-medium tracking-wide text-lib-faint">{t('library.phone.empty.formats')}</p>
      <button
        type="button"
        className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border-none bg-lib-accent px-6 text-[15px] font-semibold text-lib-on-accent transition-colors active:bg-lib-accent-hover"
        onClick={onFromDevice}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="size-5"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        {t('library.phone.empty.import')}
      </button>
    </section>
  )
}
