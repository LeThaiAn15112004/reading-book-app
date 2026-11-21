import type { ImportPlaceholder } from '@core'
import { useT } from '../../i18n'
import { placeholderStatus } from './importQueueText'

/**
 * Spec 016 (FR-010): a coming book in the Library grid — a neutral cover with a spinner, the file name and its status.
 * Not a book: no menu, cannot be opened, edited, added to a collection or removed; announced as "Importing {name}".
 */
export function ImportPlaceholderTile({ placeholder }: { placeholder: ImportPlaceholder }) {
  const t = useT()
  const status = placeholderStatus(t, placeholder)
  return (
    <div className="import-placeholder-tile" role="listitem" aria-disabled="true" aria-label={t('import.queue.placeholder.label', { name: placeholder.name })}>
      <div className="import-placeholder-cover" aria-hidden>
        {placeholder.state === 'running' ? <span className="import-queue-spinner" /> : null}
      </div>
      <span className="truncate text-xs font-medium text-lib-text-strong" aria-hidden>
        {placeholder.name}
      </span>
      <span className="import-queue-figure truncate text-[11px] text-lib-muted" aria-hidden>
        {status}
      </span>
    </div>
  )
}
