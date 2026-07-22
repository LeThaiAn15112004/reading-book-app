import { ImportMenu } from '../../../components/import'

type LibraryEmptyStateProps = {
  onFromDevice: () => void
  onFromUrl: () => void
}

/** SCR-01 empty library: large import CTAs (FR-08 / T2.1). */
export function LibraryEmptyState({
  onFromDevice,
  onFromUrl,
}: LibraryEmptyStateProps) {
  return (
    <section
      className="flex flex-col items-center justify-center px-6 py-16 text-center"
      aria-label="Empty library"
    >
      <h2 className="mb-2 text-xl font-semibold tracking-tight text-lib-text-strong">
        No files in your library yet
      </h2>
      <p className="mb-8 max-w-md text-sm leading-relaxed text-lib-muted">
        Import EPUB, PDF, TXT, or Markdown from your device or a direct file URL.
        Files stay on this machine — no bookstore.
      </p>
      <ImportMenu
        size="lg"
        onFromDevice={onFromDevice}
        onFromUrl={onFromUrl}
      />
    </section>
  )
}
