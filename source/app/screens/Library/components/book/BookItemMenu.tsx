import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { annotationTransferApi } from '../../../../bridge'
import { useT } from '../../../../i18n'
import { isFeatureAvailable, isMobileHost } from '../../../../platforms/host'
import { supportsAnnotationTransfer } from '../../../Reader/logic/annotationTransferStore'
import type {
  CollectionSummary,
  LibraryBook,
} from '@core'

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
  /** Multi-chapter audiobooks: the single destructive action (replaces Remove / Delete file). */
  onRemoveAudiobook: (id: string) => void
  /** EPUB / PDF / TXT / Markdown: save the book's annotations to a `.readmate-notes.json` file. */
  onExportAnnotations: (id: string) => void | Promise<void>
  /** EPUB / PDF / TXT / Markdown: pick a `.readmate-notes.json` file and import its annotations. */
  onImportAnnotations: (id: string) => void | Promise<void>
  /** EPUB / PDF / TXT / Markdown: save a readable Markdown copy of the book's annotations. */
  onExportReadable: (id: string) => void | Promise<void>
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
  const t = useT()
  return (
    <button
      type="button"
      className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-lib-faint transition-[opacity,color,background-color] hover:bg-white/5 hover:text-lib-text-strong focus-visible:bg-white/5 focus-visible:text-lib-text-strong focus-visible:outline-none ${className}`}
      aria-label={t('library.menu.moreActionsFor', { title })}
      title={t('library.menu.moreActions')}
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
  onRemoveAudiobook,
  onExportAnnotations,
  onImportAnnotations,
  onExportReadable,
}: BookItemMenuProps) {
  const t = useT()
  const menuRef = useRef<HTMLDivElement>(null)
  const [collectionsOpen, setCollectionsOpen] = useState(false)
  const canExportAnnotations = supportsAnnotationTransfer(book.format) && isFeatureAvailable('annotationTransfer')
  // Mobile host (spec 008, T073): a full-width sheet at the bottom; the measured desktop placement does not fit a phone.
  const phone = isMobileHost()
  const [annotationCount, setAnnotationCount] = useState(0)
  useEffect(() => {
    if (!canExportAnnotations) return
    let live = true
    void annotationTransferApi
      .count(book.id)
      .then((r) => live && setAnnotationCount(r.count))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [book.id, canExportAnnotations])
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
      aria-label={t('library.menu.actionsFor', { title: book.title })}
      className={
        phone
          ? 'phone-sheet fixed inset-x-0 bottom-0 z-[300] max-h-[80vh] overflow-y-auto rounded-t-2xl border border-lib-border bg-lib-surface-strong p-2 shadow-[0_-12px_40px_rgba(0,0,0,0.45)]'
          : 'fixed z-[300] w-[274px] rounded-xl border border-lib-border bg-lib-surface-strong p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.45)]'
      }
      style={phone ? undefined : { left, top }}
      onContextMenu={blockContextMenu}
    >
      <button className={itemClass} role="menuitem" onClick={() => run(() => onResume(book.id))}>
        {t('library.menu.resume')}
      </button>
      <div className="relative" onMouseLeave={phone ? undefined : () => setCollectionsOpen(false)}>
        <button
          className={itemClass}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={collectionsOpen}
          onMouseEnter={phone ? undefined : () => setCollectionsOpen(true)}
          onClick={() => setCollectionsOpen((open) => !open)}
        >
          <span>{t('library.menu.addToCollection')}</span>
          <span aria-hidden>›</span>
        </button>
        {collectionsOpen ? (
          <div
            className={
              phone
                ? 'pl-3'
                : `absolute top-0 w-[230px] ${
                    openCollectionsLeft
                      ? 'left-full pl-1.5'
                      : 'right-full pr-1.5'
                  }`
            }
          >
            <div
              role="menu"
              aria-label={t('library.menu.collections')}
              className={phone ? 'w-full' : 'w-56 rounded-xl border border-lib-border bg-lib-surface-strong p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.45)]'}
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
                    {included ? <span aria-label={t('library.menu.alreadyAdded')}>✓</span> : null}
                  </button>
                )
              })}
              {collections.length > 0 ? <MenuSeparator /> : null}
              <button className={itemClass} role="menuitem" onClick={() => run(onNewCollection)}>
                {t('library.menu.newCollection')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <button className={itemClass} role="menuitem" onClick={() => run(() => onToggleFavorite(book))}>
        {book.isFavorite ? t('library.menu.removeFavorite') : t('library.menu.addFavorite')}
      </button>
      <button
        className={itemClass}
        role="menuitem"
        disabled={book.status === 'completed'}
        onClick={() => run(() => onMarkCompleted(book.id))}
      >
        {t('library.menu.markCompleted')}
      </button>
      <MenuSeparator />
      <button className={itemClass} role="menuitem" onClick={() => run(() => onDetails(book.id))}>
        {t('library.menu.details')}
      </button>
      <button className={itemClass} role="menuitem" onClick={() => run(() => onEditMetadata(book.id))}>
        {t('library.menu.editMetadata')}
      </button>
      {activeCollectionId ? (
        <button
          className={itemClass}
          role="menuitem"
          onClick={() =>
            run(() => onRemoveFromCollection(activeCollectionId, book.id))
          }
        >
          {t('library.menu.removeFromCollection')}
        </button>
      ) : null}
      {canExportAnnotations ? (
        <button
          className={itemClass}
          role="menuitem"
          disabled={annotationCount === 0}
          title={annotationCount === 0 ? t('library.menu.noAnnotations') : undefined}
          onClick={() => run(() => onExportAnnotations(book.id))}
        >
          {t('library.menu.exportAnnotations')}
        </button>
      ) : null}
      {canExportAnnotations ? (
        <button
          className={itemClass}
          role="menuitem"
          disabled={annotationCount === 0}
          title={annotationCount === 0 ? t('library.menu.noAnnotations') : undefined}
          onClick={() => run(() => onExportReadable(book.id))}
        >
          {t('library.menu.exportReadable')}
        </button>
      ) : null}
      {canExportAnnotations ? (
        <button className={itemClass} role="menuitem" onClick={() => run(() => onImportAnnotations(book.id))}>
          {t('library.menu.importAnnotations')}
        </button>
      ) : null}
      {isFeatureAvailable('fileSystemActions') ? (
        <>
          <MenuSeparator />
          <button className={itemClass} role="menuitem" onClick={() => run(() => onOpenFileLocation(book.id))}>
            {t('library.menu.openFileLocation')}
          </button>
          <button className={itemClass} role="menuitem" onClick={() => run(() => onCopyFilePath(book.id))}>
            {t('library.menu.copyFilePath')}
          </button>
        </>
      ) : null}
      <MenuSeparator />
      {book.chapterCount ? (
        // A multi-chapter audiobook's files are all app-owned copies: "remove the record, keep the files" would leave
        // an unreachable folder, so there is one action and it says what it deletes.
        <button
          className={`${itemClass} text-red-400 hover:text-red-300`}
          role="menuitem"
          onClick={() => run(() => onRemoveAudiobook(book.id))}
        >
          {t('library.menu.removeAudiobook')}
        </button>
      ) : (
        <button className={itemClass} role="menuitem" onClick={() => run(() => onRemove(book.id))}>
          {t('library.menu.removeFromLibrary')}
        </button>
      )}
      {/* Only app-owned copies can be deleted; a referenced book's file is the user's own. */}
      {!book.chapterCount && book.fileStorage === 'managed' ? (
        <button
          className={`${itemClass} text-red-400 hover:text-red-300`}
          role="menuitem"
          onClick={() => run(() => onDeleteFile(book.id))}
        >
          {t('library.menu.deleteFile')}
        </button>
      ) : null}
    </div>
  )
}

function MenuSeparator() {
  return <div className="my-1 border-t border-lib-border-soft" role="separator" />
}
