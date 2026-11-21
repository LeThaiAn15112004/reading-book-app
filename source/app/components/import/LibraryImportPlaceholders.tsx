import { placeholdersOf } from '@core'
import { useImportQueueStore } from '../../hooks/library/importQueueStore'
import { ImportPlaceholderRow } from './ImportPlaceholderRow'
import { ImportPlaceholderTile } from './ImportPlaceholderTile'

/**
 * Spec 016 (FR-010, research R8): the coming books, first in the Library's "All books" view only (Grid or List, both
 * hosts) — never in Collections, other filters or search results. Derived from the queue; never a library row.
 */
export function LibraryImportPlaceholders({ layout, visible }: { layout: 'grid' | 'table' | string; visible: boolean }) {
  const queue = useImportQueueStore((s) => s.queue)
  if (!visible) return null
  const placeholders = placeholdersOf(queue)
  if (placeholders.length === 0) return null
  return layout === 'table' ? (
    <div role="list" className="mb-2 flex flex-col">
      {placeholders.map((p) => (
        <ImportPlaceholderRow key={p.jobId} placeholder={p} />
      ))}
    </div>
  ) : (
    <div role="list" className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-4">
      {placeholders.map((p) => (
        <ImportPlaceholderTile key={p.jobId} placeholder={p} />
      ))}
    </div>
  )
}
