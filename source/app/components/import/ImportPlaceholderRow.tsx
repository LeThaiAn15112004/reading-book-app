import type { ImportPlaceholder } from '@core'
import { useT } from '../../i18n'
import { placeholderStatus } from './importQueueText'

/** Columns of the Desktop Library table (`LibraryBookTable`): a placeholder row spans them all. */
const TABLE_COLUMNS = 8

/**
 * Spec 016 (FR-010): a coming book in the Library list — same rules as `ImportPlaceholderTile` (not a book). Drawn as
 * a list item of the phone list (`li`) or a row of the Desktop table (`tr`).
 */
export function ImportPlaceholderRow({ placeholder, as }: { placeholder: ImportPlaceholder; as: 'li' | 'tr' }) {
  const t = useT()
  const status = placeholderStatus(t, placeholder)
  const label = t('import.queue.placeholder.label', { name: placeholder.name })
  const content = (
    <div className="import-placeholder-row">
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
  if (as === 'tr') {
    return (
      <tr aria-disabled="true" aria-label={label}>
        <td colSpan={TABLE_COLUMNS} className="p-0">
          {content}
        </td>
      </tr>
    )
  }
  return (
    <li className="list-none" aria-disabled="true" aria-label={label}>
      {content}
    </li>
  )
}
