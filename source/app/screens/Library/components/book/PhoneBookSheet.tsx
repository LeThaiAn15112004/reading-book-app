import { continueAction } from '@core'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useT } from '../../../../i18n'
import { BookCover } from './BookCover'
import { CheckIcon, type BookItemMenuProps } from './BookItemMenu'

/** `onReadAgain` / `onMarkReading` (research R9: `markAsReading`, the location is kept) are used here only. */
export type PhoneBookSheetProps = BookItemMenuProps

/** Drag on the handle further than this (px), or flick faster than FLING_PX_PER_MS, and the sheet closes. */
const CLOSE_DISTANCE_PX = 64
const FLING_PX_PER_MS = 0.6

/** History entry pushed while the sheet is open, so the Android Back gesture (`history.back()`) closes it. */
const SHEET_HISTORY_KEY = 'readmateBookSheet'

const itemClass =
  'flex min-h-12 w-full cursor-pointer items-center justify-between gap-4 rounded-lg border-none bg-transparent px-3 text-left text-[15px] text-lib-text-strong active:bg-lib-surface-hover disabled:cursor-default disabled:opacity-45'

/**
 * The book menu on the phone (spec 013 US4, FR-016 – FR-020): a bottom sheet with the same actions in the same order
 * from the Continue Reading row, the grid and the list. Actions that do not exist on the phone (file location, copy
 * path, annotation import / export, delete the original file, audiobooks) are not rendered — hidden, never disabled.
 *
 * It closes without an action on a swipe down (handle area), a tap on the backdrop and the system Back gesture.
 */
export function PhoneBookSheet({
  book,
  collections,
  onClose,
  onResume,
  onReadAgain,
  onAddToCollection,
  activeCollectionId,
  onRemoveFromCollection,
  onNewCollection,
  onToggleFavorite,
  onMarkCompleted,
  onMarkReading,
  onDetails,
  onEditMetadata,
  onRemove,
}: PhoneBookSheetProps) {
  const t = useT()
  const [collectionsOpen, setCollectionsOpen] = useState(false)
  const [dragY, setDragY] = useState(0)
  const drag = useRef<{ startY: number; startTime: number; pointerId: number } | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  /** An action chosen in the sheet runs only once the sheet's history entry is gone (see `run`). */
  const pendingTask = useRef<(() => void | Promise<void>) | null>(null)
  /** True while the current history entry is this sheet's own (set by the effect below). */
  const entryIsOurs = useRef<() => boolean>(() => false)

  // System Back: one history entry while open; Back pops it and closes the sheet. Closing any other way removes the
  // entry again, so the next Back goes where it went before (FR-019). The entry carries an id of THIS sheet and is
  // pushed on a 0 ms timer: React StrictMode mounts effects twice in development, and the first cleanup cancels the
  // timer instead of pushing and popping an entry whose late `popstate` would close the second sheet.
  useEffect(() => {
    const id = `${Date.now()}-${Math.random()}`
    const isOurEntry = () => (window.history.state as Record<string, unknown> | null)?.[SHEET_HISTORY_KEY] === id
    let pushed = false
    const timer = window.setTimeout(() => {
      window.history.pushState({ ...(window.history.state as object | null), [SHEET_HISTORY_KEY]: id }, '')
      pushed = true
    }, 0)
    const onPopState = () => {
      if (!pushed || isOurEntry()) return
      pushed = false
      const task = pendingTask.current
      pendingTask.current = null
      onCloseRef.current()
      if (task) void task()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    entryIsOurs.current = isOurEntry
    window.addEventListener('popstate', onPopState)
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('keydown', onKey)
      entryIsOurs.current = () => false
      if (pushed && isOurEntry()) window.history.back()
    }
  }, [])

  const action = continueAction(book)
  const completed = book.status === 'completed'

  /**
   * Close, then act. While the sheet's history entry is current it is popped first and the action runs on that
   * `popstate`: an action that navigates (open the book) must not push its route on top of the sheet's entry, or the
   * next Back would land on the closed sheet instead of the Library.
   */
  function run(task: () => void | Promise<void>) {
    if (entryIsOurs.current()) {
      pendingTask.current = task
      window.history.back()
      return
    }
    onClose()
    void task()
  }

  function onHandleDown(event: ReactPointerEvent<HTMLDivElement>) {
    drag.current = { startY: event.clientY, startTime: event.timeStamp, pointerId: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onHandleMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    setDragY(Math.max(0, event.clientY - drag.current.startY))
  }

  function onHandleUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current
    drag.current = null
    if (!start || start.pointerId !== event.pointerId) return
    const distance = event.clientY - start.startY
    const speed = distance / Math.max(1, event.timeStamp - start.startTime)
    if (distance > CLOSE_DISTANCE_PX || speed > FLING_PX_PER_MS) onClose()
    else setDragY(0)
  }

  return (
    <div className="fixed inset-0 z-[300]">
      <button
        type="button"
        className="absolute inset-0 cursor-default border-none bg-black/45"
        aria-label={t('library.phone.sheet.close')}
        onClick={onClose}
      />
      <div
        role="menu"
        aria-label={t('library.menu.actionsFor', { title: book.title })}
        className="phone-sheet absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-lib-border bg-lib-surface-strong px-2 shadow-[var(--lib-overlay-shadow)]"
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragY ? 'none' : 'transform 160ms ease-out',
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {/* Handle + book header: the drag area (touch-action none so the drag is not taken as a scroll). */}
        <div
          className="sticky top-0 z-10 -mx-2 cursor-grab touch-none rounded-t-2xl bg-lib-surface-strong px-4 pt-2 pb-3"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-lib-border" aria-hidden />
          <div className="flex items-center gap-3">
            <BookCover
              bookId={book.id}
              title={book.title}
              coverUrl={book.coverUrl}
              compact
              className="h-16 w-11 shrink-0 rounded-md"
              titleClassName="line-clamp-3 text-[8px] leading-tight font-semibold text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]"
            />
            <div className="min-w-0">
              <p className="m-0 truncate text-[15px] font-semibold text-lib-text-strong">{book.title}</p>
              <p className="m-0 truncate text-[13px] text-lib-faint">{book.author}</p>
            </div>
          </div>
        </div>

        <SheetSeparator />

        {action === 'read-again' && onReadAgain ? (
          <button className={itemClass} role="menuitem" onClick={() => run(() => onReadAgain(book.id))}>
            {t('library.continue.readAgain')}
          </button>
        ) : (
          <button className={itemClass} role="menuitem" onClick={() => run(() => onResume(book.id))}>
            {t('library.menu.resume')}
          </button>
        )}

        <button
          className={itemClass}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={collectionsOpen}
          onClick={() => setCollectionsOpen((open) => !open)}
        >
          <span>{t('library.menu.addToCollection')}</span>
          <span aria-hidden className={`transition-transform ${collectionsOpen ? 'rotate-90' : ''}`}>
            ›
          </span>
        </button>
        {collectionsOpen ? (
          <div role="menu" aria-label={t('library.menu.collections')} className="pl-4">
            {collections.map((collection) => {
              // Spec 015 FR-011: a toggle — choosing a collection that holds the book removes it (with Undo).
              const included = collection.bookIds.includes(book.id)
              return (
                <button
                  key={collection.id}
                  className={itemClass}
                  role="menuitemcheckbox"
                  aria-checked={included}
                  onClick={() =>
                    run(() =>
                      included
                        ? onRemoveFromCollection(collection.id, book.id)
                        : onAddToCollection(collection.id, book.id),
                    )
                  }
                >
                  <span className="truncate">{collection.name}</span>
                  {included ? <CheckIcon className="size-5 shrink-0 text-lib-accent" /> : null}
                </button>
              )
            })}
            <button className={itemClass} role="menuitem" onClick={() => run(onNewCollection)}>
              {t('library.menu.newCollection')}
            </button>
          </div>
        ) : null}

        <button className={itemClass} role="menuitem" onClick={() => run(() => onToggleFavorite(book))}>
          {book.isFavorite ? t('library.menu.removeFavorite') : t('library.menu.addFavorite')}
        </button>

        {completed && onMarkReading ? (
          <button className={itemClass} role="menuitem" onClick={() => run(() => onMarkReading(book.id))}>
            {t('library.menu.markReading')}
          </button>
        ) : (
          <button
            className={itemClass}
            role="menuitem"
            disabled={completed}
            onClick={() => run(() => onMarkCompleted(book.id))}
          >
            {t('library.menu.markCompleted')}
          </button>
        )}

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
            onClick={() => run(() => onRemoveFromCollection(activeCollectionId, book.id))}
          >
            {t('library.menu.removeFromCollection')}
          </button>
        ) : null}

        <SheetSeparator />
        <button className={`${itemClass} text-lib-danger`} role="menuitem" onClick={() => run(() => onRemove(book.id))}>
          {t('library.menu.removeFromLibrary')}
        </button>
      </div>
    </div>
  )
}

function SheetSeparator() {
  return <div className="my-1 border-t border-lib-border-soft" role="separator" />
}
