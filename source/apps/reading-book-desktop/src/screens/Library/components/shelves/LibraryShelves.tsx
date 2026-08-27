import { useState } from 'react'
import type { ReactNode } from 'react'
import { ShelfSection, type ShelfId } from './ShelfSection'

export type LibrarySectionId = ShelfId | 'favorites'

/** Default order: Recent Books first, then Favorites → Completed → Not started. */
export const LIBRARY_SHELVES: ReadonlyArray<{ id: LibrarySectionId; title: string }> = [
  { id: 'reading', title: 'Recent Books' },
  { id: 'favorites', title: 'Favorites' },
  { id: 'completed', title: 'Completed' },
  { id: 'not-started', title: 'Not started' },
]

export type ShelfCounts = Partial<Record<LibrarySectionId, number>>
export type ShelfRailContent = Partial<Record<LibrarySectionId, ReactNode>>

type LibraryShelvesProps = {
  onOpenShelf?: (id: LibrarySectionId) => void
  /** Per-shelf file counts; omitted shelves default to 0 (empty OK). */
  counts?: ShelfCounts
  /** Optional subset of shelves to render, in display order. */
  shelfIds?: ReadonlyArray<LibrarySectionId>
  /** Optional rail children per shelf; omit → empty-section copy. */
  railContent?: ShelfRailContent
  /** When true, hide shelves whose count is 0 (search filter — T1.8). */
  hideEmpty?: boolean
  viewMode?: 'grid' | 'list'
  /** Enables drag-to-reorder on section headers; called with the new order of the rendered shelves. */
  onReorderShelves?: (newOrder: ReadonlyArray<LibrarySectionId>) => void
}

/** SCR-01 shelves hub — sections render in caller-supplied order (empty data OK for T1.5). */
export function LibraryShelves({
  onOpenShelf,
  counts,
  shelfIds,
  railContent,
  hideEmpty = false,
  viewMode = 'grid',
  onReorderShelves,
}: LibraryShelvesProps) {
  const [draggedId, setDraggedId] = useState<LibrarySectionId | null>(null)
  const [dragOverId, setDragOverId] = useState<LibrarySectionId | null>(null)

  const scopedShelves = shelfIds
    ? shelfIds
      .map((id) => LIBRARY_SHELVES.find((shelf) => shelf.id === id))
      .filter((shelf): shelf is (typeof LIBRARY_SHELVES)[number] => shelf != null)
    : LIBRARY_SHELVES
  const shelves = hideEmpty
    ? scopedShelves.filter((shelf) => (counts?.[shelf.id] ?? 0) > 0)
    : scopedShelves

  const canReorder = onReorderShelves != null && shelves.length > 1

  function handleDrop(targetId: LibrarySectionId) {
    if (!draggedId || draggedId === targetId || !onReorderShelves) {
      setDraggedId(null)
      setDragOverId(null)
      return
    }
    const currentOrder = shelves.map((s) => s.id)
    const fromIndex = currentOrder.indexOf(draggedId)
    const toIndex = currentOrder.indexOf(targetId)
    if (fromIndex !== -1 && toIndex !== -1) {
      const next = [...currentOrder]
      next.splice(fromIndex, 1)
      next.splice(toIndex, 0, draggedId)
      onReorderShelves(next)
    }
    setDraggedId(null)
    setDragOverId(null)
  }

  return (
    <div className="relative flex flex-col" id="shelfList">
      {shelves.map((shelf) => (
        <ShelfSection
          key={shelf.id}
          id={shelf.id}
          title={shelf.title}
          fileCount={counts?.[shelf.id] ?? 0}
          onOpen={onOpenShelf}
          viewMode={viewMode}
          children={railContent?.[shelf.id]}
          draggable={canReorder}
          isDragging={draggedId === shelf.id}
          isDragOver={dragOverId === shelf.id && draggedId !== shelf.id}
          onSectionDragStart={() => setDraggedId(shelf.id)}
          onSectionDragOver={() => setDragOverId(shelf.id)}
          onSectionDrop={() => handleDrop(shelf.id)}
          onSectionDragEnd={() => {
            setDraggedId(null)
            setDragOverId(null)
          }}
        />
      ))}
    </div>
  )
}
