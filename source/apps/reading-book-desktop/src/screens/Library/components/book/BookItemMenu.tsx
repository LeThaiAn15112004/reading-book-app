import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type {
  CollectionSummary,
  LibraryBook,
} from '@reading-book/shared/models'

export type BookMenuPoint = { x: number; y: number }

export type BookItemMenuProps = {
  book: LibraryBook
  point: BookMenuPoint
  collections: CollectionSummary[]
  onClose: () => void
  onResume: (id: string) => void
  onAddToCollection: (collectionId: string, bookId: string) => void
  activeCollectionId?: string
  onRemoveFromCollection: (collectionId: string, bookId: string) => void
  onNewCollection: () => void
  onToggleFavorite: (book: LibraryBook) => void | Promise<void>
  onMarkCompleted: (id: string) => void | Promise<void>
  onDetails: (id: string) => void
  onEditMetadata: (id: string) => void
  onOpenFileLocation: (id: string) => void | Promise<void>
  onCopyFilePath: (id: string) => void | Promise<void>
  onRemove: (id: string) => void
  onDeleteFile: (id: string) => void
}

export function MoreVertIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  )
}

export type BookMenuButtonProps = {
  title: string
  onOpen: (point: BookMenuPoint) => void
  className?: string
}

export function BookMenuButton({
  title,
  onOpen,
  className = '',
}: BookMenuButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-lib-faint transition-[opacity,color,background-color] hover:bg-white/5 hover:text-lib-text-strong focus-visible:bg-white/5 focus-visible:text-lib-text-strong focus-visible:outline-none ${className}`}
      aria-label={`More actions for ${title}`}
      title="More actions"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        onOpen({ x: rect.right, y: rect.bottom + 4 })
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpen({ x: event.clientX, y: event.clientY })
      }}
    >
      <MoreVertIcon className="size-5" />
    </button>
  )
}

const itemClass =
  'flex h-8 w-full cursor-pointer items-center justify-between gap-4 rounded-md border-none bg-transparent px-2.5 text-left text-[13px] text-lib-text-strong hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none disabled:cursor-default disabled:opacity-45'

export function BookItemMenu({
  book,
  point,
  collections,
  onClose,
  onResume,
  onAddToCollection,
  activeCollectionId,
  onRemoveFromCollection,
  onNewCollection,
  onToggleFavorite,
  onMarkCompleted,
  onDetails,
  onEditMetadata,
  onOpenFileLocation,
  onCopyFilePath,
  onRemove,
  onDeleteFile,
}: BookItemMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [collectionsOpen, setCollectionsOpen] = useState(false)
  const left = Math.max(8, Math.min(point.x, window.innerWidth - 282))
  const top = Math.max(8, Math.min(point.y, window.innerHeight - 390))
  const openCollectionsLeft = left + 506 <= window.innerWidth

  useEffect(() => {
    const closeOnPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', closeOnPointer)
    window.addEventListener('keydown', closeOnKey)
    return () => {
      window.removeEventListener('pointerdown', closeOnPointer)
      window.removeEventListener('keydown', closeOnKey)
    }
  }, [onClose])

  function run(action: () => void | Promise<void>) {
    onClose()
    void action()
  }

  function blockContextMenu(event: ReactMouseEvent) {
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${book.title}`}
      className="fixed z-[300] w-[274px] rounded-xl border border-lib-border bg-lib-surface-strong p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
      style={{ left, top }}
      onContextMenu={blockContextMenu}
    >
      <button className={itemClass} role="menuitem" onClick={() => run(() => onResume(book.id))}>
        Resume reading
      </button>
      <div className="relative" onMouseLeave={() => setCollectionsOpen(false)}>
        <button
          className={itemClass}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={collectionsOpen}
          onMouseEnter={() => setCollectionsOpen(true)}
          onClick={() => setCollectionsOpen((open) => !open)}
        >
          <span>Add to collection</span>
          <span aria-hidden>›</span>
        </button>
        {collectionsOpen ? (
          <div
            className={`absolute top-0 w-[230px] ${
              openCollectionsLeft
                ? 'left-full pl-1.5'
                : 'right-full pr-1.5'
            }`}
          >
            <div
              role="menu"
              aria-label="Collections"
              className="w-56 rounded-xl border border-lib-border bg-lib-surface-strong p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
            >
              {collections.map((collection) => {
                const included = collection.bookIds.includes(book.id)
                return (
                  <button
                    key={collection.id}
                    className={itemClass}
                    role="menuitem"
                    disabled={included}
                    onClick={() =>
                      run(() => onAddToCollection(collection.id, book.id))
                    }
                  >
                    <span className="truncate">{collection.name}</span>
                    {included ? <span aria-label="Already added">✓</span> : null}
                  </button>
                )
              })}
              {collections.length > 0 ? <MenuSeparator /> : null}
              <button className={itemClass} role="menuitem" onClick={() => run(onNewCollection)}>
                New collection…
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <button className={itemClass} role="menuitem" onClick={() => run(() => onToggleFavorite(book))}>
        {book.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      </button>
      <button
        className={itemClass}
        role="menuitem"
        disabled={book.status === 'completed'}
        onClick={() => run(() => onMarkCompleted(book.id))}
      >
        Mark as completed
      </button>
      <MenuSeparator />
      <button className={itemClass} role="menuitem" onClick={() => run(() => onDetails(book.id))}>
        Book details
      </button>
      <button className={itemClass} role="menuitem" onClick={() => run(() => onEditMetadata(book.id))}>
        Edit metadata
      </button>
      {activeCollectionId ? (
        <button
          className={itemClass}
          role="menuitem"
          onClick={() =>
            run(() => onRemoveFromCollection(activeCollectionId, book.id))
          }
        >
          Remove from this collection
        </button>
      ) : null}
      <MenuSeparator />
      <button className={itemClass} role="menuitem" onClick={() => run(() => onOpenFileLocation(book.id))}>
        Open file location
      </button>
      <button className={itemClass} role="menuitem" onClick={() => run(() => onCopyFilePath(book.id))}>
        Copy file path
      </button>
      <MenuSeparator />
      <button className={itemClass} role="menuitem" onClick={() => run(() => onRemove(book.id))}>
        Remove from library
      </button>
      <button
        className={`${itemClass} text-red-400 hover:text-red-300`}
        role="menuitem"
        onClick={() => run(() => onDeleteFile(book.id))}
      >
        Delete file…
      </button>
    </div>
  )
}

function MenuSeparator() {
  return <div className="my-1 border-t border-lib-border-soft" role="separator" />
}
