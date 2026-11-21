import type { ImportPlaceholder } from '@core'
import { useT } from '../../i18n'
import type { ImportSlot } from './useImportSlot'
import { ImportPlaceholderRow } from './ImportPlaceholderRow'
import { ImportPlaceholderTile } from './ImportPlaceholderTile'

/** The placeholders as items of a container: grid tiles, phone list items or table rows. */
export function ImportPlaceholderItems({ placeholders, as }: { placeholders: ImportPlaceholder[]; as: 'tile' | 'li' | 'tr' }) {
  return (
    <>
      {placeholders.map((p) =>
        as === 'tile' ? <ImportPlaceholderTile key={p.jobId} placeholder={p} /> : <ImportPlaceholderRow key={p.jobId} placeholder={p} as={as} />,
      )}
    </>
  )
}

/** "3 books added to the Library" — only when this run's books are sorted elsewhere in the list. */
export function ImportAddedNote({ slot }: { slot: ImportSlot }) {
  const t = useT()
  if (slot.addedElsewhere === 0) return null
  return (
    <p className="mt-0 mb-2 text-xs text-lib-muted">{t('import.queue.placeholder.added', { count: slot.addedElsewhere })}</p>
  )
}
