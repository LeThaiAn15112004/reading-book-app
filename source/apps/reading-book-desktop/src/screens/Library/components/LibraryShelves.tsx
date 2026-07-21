import { ShelfSection, type ShelfId } from './ShelfSection'

const SHELVES: ReadonlyArray<{ id: ShelfId; title: string }> = [
  { id: 'reading', title: 'Reading' },
  { id: 'completed', title: 'Completed' },
  { id: 'not-started', title: 'Not started' },
]

type LibraryShelvesProps = {
  onOpenShelf?: (id: ShelfId) => void
}

/** SCR-01 shelves hub — Reading → Completed → Not started (empty data OK for T1.5). */
export function LibraryShelves({ onOpenShelf }: LibraryShelvesProps) {
  return (
    <div className="flex flex-col" id="shelfList">
      {SHELVES.map((shelf) => (
        <ShelfSection
          key={shelf.id}
          id={shelf.id}
          title={shelf.title}
          fileCount={0}
          onOpen={onOpenShelf}
        />
      ))}
    </div>
  )
}
