import { ImportMenu } from '../../../../components/import'
import { useT } from '../../../../i18n'

type LibraryEmptyStateProps = {
  onFromDevice: () => void
  onFromUrl: () => void
}

/** SCR-01 empty library: large import CTAs (FR-08 / T2.1). */
export function LibraryEmptyState({
  onFromDevice,
  onFromUrl,
}: LibraryEmptyStateProps) {
  const t = useT()
  return (
    <section
      className="flex flex-col items-center justify-center px-6 py-16 text-center"
      aria-label={t('library.empty.aria')}
    >
      <h2 className="mb-2 text-xl font-semibold tracking-tight text-lib-text-strong">
        {t('library.empty.title')}
      </h2>
      <p className="mb-8 max-w-md text-sm leading-relaxed text-lib-muted">
        {t('library.empty.body')}
      </p>
      <ImportMenu
        size="lg"
        onFromDevice={onFromDevice}
        onFromUrl={onFromUrl}
      />
    </section>
  )
}
