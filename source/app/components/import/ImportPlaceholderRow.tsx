import type { ImportPlaceholder } from '@core'
import { useT } from '../../i18n'
import { placeholderStatus } from './importQueueText'

/** Spec 016 (FR-010): a coming book in the Library list — same rules as `ImportPlaceholderTile` (not a book). */
export function ImportPlaceholderRow({ placeholder }: { placeholder: ImportPlaceholder }) {
  const t = useT()
  const status = placeholderStatus(t, placeholder)
  return (
    <div className="import-placeholder-row" role="listitem" aria-disabled="true" aria-label={t('import.queue.placeholder.label', { name: placeholder.name })}>
      <div className="import-placeholder-cover import-placeholder-cover--small" aria-hidden>
        {placeholder.state === 'running' ? <span className="import-queue-spinner" /> : null}
      </div>
      <span className="min-w-0 flex-1 truncate text-sm text-lib-text-strong" aria-hidden>
        {placeholder.name}
      </span>
      <span className="import-queue-figure shrink-0 text-xs text-lib-muted" aria-hidden>
        {status}
      </span>
    </div>
  )
}
