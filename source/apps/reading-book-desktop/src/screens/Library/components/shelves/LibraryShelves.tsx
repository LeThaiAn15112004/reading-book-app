import type { ReactNode } from 'react'
import { ShelfSection, type ShelfId } from './ShelfSection'

/** Fixed SCR-01 order: Reading → Completed → Not started. */
export const LIBRARY_SHELVES: ReadonlyArray<{ id: ShelfId; title: string }> = [
  { id: 'reading', title: 'Reading' },
  { id: 'completed', title: 'Completed' },
  { id: 'not-started', title: 'Not started' },
]

export type ShelfCounts = Partial<Record<ShelfId, number>>
export type ShelfRailContent = Partial<Record<ShelfId, ReactNode>>

type LibraryShelvesProps = {
  onOpenShelf?: (id: ShelfId) => void
  /** Per-shelf file counts; omitted shelves default to 0 (empty OK). */
  counts?: ShelfCounts
  /** Optional rail children per shelf; omit → empty-section copy. */
  railContent?: ShelfRailContent
  /** When true, hide shelves whose count is 0 (search filter — T1.8). */
  hideEmpty?: boolean
}

/** SCR-01 shelves hub — Reading → Completed → Not started (empty data OK for T1.5). */
export function LibraryShelves({
  onOpenShelf,
  counts,
  railContent,
  hideEmpty = false,
}: LibraryShelvesProps) {
  const shelves = hideEmpty
    ? LIBRARY_SHELVES.filter((shelf) => (counts?.[shelf.id] ?? 0) > 0)
    : LIBRARY_SHELVES

  return (
    <div className="relative flex flex-col" id="shelfList">
      {shelves.map((shelf) => (
        <ShelfSection
          key={shelf.id}
          id={shelf.id}
          title={shelf.title}
          fileCount={counts?.[shelf.id] ?? 0}
          onOpen={onOpenShelf}
          children={railContent?.[shelf.id]}
        />
      ))}
    </div>
  )
}
