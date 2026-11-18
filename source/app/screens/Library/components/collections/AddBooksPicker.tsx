import { pickerRows, type CollectionSummary, type LibraryBook } from '@core'
import { useEffect, useId, useMemo, useRef } from 'react'
import { useBackClose } from '../../../../hooks/app/useBackClose'
import { useDialogFocus } from '../../../../hooks/app/useDialogFocus'
import { useT } from '../../../../i18n'
import { isMobileHost } from '../../../../platforms/host'
import { useAddBooksPickerStore } from '../../logic/addBooksPickerStore'
import { BookCover } from '../book/BookCover'

export type AddBooksPickerProps = {
  /** Every library book, already in the Library's current sort order. */
  books: readonly LibraryBook[]
  collection: CollectionSummary
  /** Adds the ticked books (in tick order); resolves false when nothing was added (the picker stays open). */
  onConfirm: (bookIds: string[]) => Promise<boolean>
  /** Empty library: close the picker and start the ordinary import. */
  onImportBooks: () => void
}

/**
 * "Add books" (spec 015 US2, FR-008 / FR-009, research R8): every library book with a search by title or author,
 * multi-selection in tick order, books already in the collection shown as included and not selectable. Desktop: a
 * centred dialog; phone: a full-screen page with the search on top and a fixed "Add (n)" bar at the bottom, closed by
 * the system Back. Keyboard focus stays inside and returns to the opener (FR-016).
 */
export function AddBooksPicker({ books, collection, onConfirm, onImportBooks }: AddBooksPickerProps) {
  const t = useT()
  const phone = isMobileHost()
  const titleId = useId()
  const includedHintId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const { open, query, selected, submitting, error, close, setQuery, toggle, setSubmitting, setError } =
    useAddBooksPickerStore()

  // An empty library disables the search: focus then goes to the first control (Import books).
  useDialogFocus(open, rootRef, { initialFocusRef: books.length > 0 ? searchRef : undefined })
  useBackClose(open, close)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const rows = useMemo(() => pickerRows(books, collection.bookIds, query), [books, collection.bookIds, query])
  if (!open) return null

  const count = selected.length
  const libraryEmpty = books.length === 0

  async function confirm() {
    if (count === 0 || submitting) return
    setSubmitting(true)
    setError(false)
    try {
      const ok = await onConfirm([...selected])
      if (!ok) setError(true)
    } catch {
      setError(true)
    } finally {
      // The picker may already be closed (success): `setSubmitting` on the reset store is harmless.
      setSubmitting(false)
    }
  }

  const iconButton =
    'inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent'

  const list = libraryEmpty ? (
    <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <p className="m-0 text-sm text-lib-muted">{t('library.picker.libraryEmpty')}</p>
      <button
        type="button"
        className="inline-flex h-11 cursor-pointer items-center rounded-lg border-none bg-lib-accent px-5 text-[13px] font-semibold text-lib-on-accent hover:bg-lib-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent"
        onClick={onImportBooks}
      >
        {t('library.picker.libraryEmptyAction')}
      </button>
    </div>
  ) : rows.length === 0 ? (
    <p className="m-0 px-6 py-12 text-center text-sm text-lib-muted">
      {t('library.picker.noMatch', { query: query.trim() })}
    </p>
  ) : (
    <ul className="m-0 list-none p-0" aria-labelledby={titleId}>
      {rows.map(({ book, included }) => {
        const checked = included || selected.includes(book.id)
        return (
          <li key={book.id} style={{ contentVisibility: 'auto', containIntrinsicSize: '0 60px' }}>
            <label
              className={`group flex min-h-[60px] items-center gap-3 px-4 py-2 ${
                included ? 'cursor-default' : 'cursor-pointer hover:bg-lib-surface-hover'
              } has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-lib-accent`}
            >
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-[var(--lib-accent)] focus-visible:outline-none"
                checked={checked}
                disabled={included}
                aria-describedby={included ? includedHintId : undefined}
                onChange={() => toggle(book.id)}
              />
              <BookCover
                bookId={book.id}
                title={book.title}
                coverUrl={book.coverUrl}
                compact
                className="h-[46px] w-8 shrink-0 rounded-[4px]"
                titleClassName="line-clamp-3 text-[6px] leading-tight font-semibold text-white"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] font-medium text-lib-text-strong">{book.title}</span>
                <span className="truncate text-[12px] text-lib-muted group-hover:text-lib-text">{book.author}</span>
                {included ? <span className="text-[12px] text-lib-muted">{t('library.picker.inCollection')}</span> : null}
              </span>
            </label>
          </li>
        )
      })}
    </ul>
  )

  const search = (
    <div className="px-4 pb-3">
      <label className="sr-only" htmlFor={`${titleId}-search`}>
        {t('library.picker.searchLabel')}
      </label>
      <input
        ref={searchRef}
        id={`${titleId}-search`}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('library.picker.searchPlaceholder')}
        disabled={libraryEmpty}
        className="h-11 w-full rounded-lg border border-lib-border bg-lib-input px-3 text-sm text-lib-text-strong outline-none placeholder:text-lib-muted focus:border-lib-accent focus:shadow-[0_0_0_3px_var(--color-lib-accent-soft)]"
      />
    </div>
  )

  const footer = (
    <div
      className={`shrink-0 border-t border-lib-border-soft bg-lib-surface-strong px-4 pt-3 ${
        phone ? 'pb-[calc(12px+env(safe-area-inset-bottom))]' : 'pb-3'
      }`}
    >
      {error ? (
        <p role="alert" className="m-0 mb-2 text-[13px] text-lib-danger">
          {t('library.toast.addManyFailed')}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {t('library.picker.selectedCount', { count })}
      </p>
      {phone ? (
        <button
          type="button"
          className="inline-flex h-12 w-full cursor-pointer items-center justify-center rounded-lg border-none bg-lib-accent text-[15px] font-semibold text-lib-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-not-allowed disabled:opacity-50"
          disabled={count === 0 || submitting}
          onClick={() => void confirm()}
        >
          {t('library.picker.add', { count })}
        </button>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-lib-muted" aria-hidden>
            {t('library.picker.selectedCount', { count })}
          </span>
          <div className="flex gap-2.5">
            <button
              type="button"
              className="inline-flex h-[38px] cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-medium text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent"
              onClick={close}
            >
              {t('common.actions.cancel')}
            </button>
            <button
              type="button"
              className="inline-flex h-[38px] cursor-pointer items-center rounded-lg border-none bg-lib-accent px-4 text-[13px] font-semibold text-lib-on-accent hover:bg-lib-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-not-allowed disabled:opacity-50"
              disabled={count === 0 || submitting}
              onClick={() => void confirm()}
            >
              {t('library.picker.add', { count })}
            </button>
          </div>
        </div>
      )}
    </div>
  )

  if (phone) {
    return (
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-0 z-[320] flex h-[100dvh] flex-col bg-lib-bg-deep"
      >
        <span id={includedHintId} hidden>
          {t('library.picker.inCollection')}
        </span>
        <header className="flex shrink-0 items-center gap-2 px-1 pt-[env(safe-area-inset-top)] pb-2">
          <button type="button" className={iconButton} aria-label={t('common.actions.close')} onClick={close}>
            <BackArrowIcon className="size-6" />
          </button>
          <h2 id={titleId} className="m-0 line-clamp-2 min-w-0 flex-1 text-[17px] font-semibold text-lib-text-strong">
            {t('library.picker.title', { name: collection.name })}
          </h2>
        </header>
        {search}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{list}</div>
        {footer}
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[320] flex items-center justify-center bg-lib-bg-deep/65 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-[80vh] max-h-[720px] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-lib-border bg-lib-surface-strong shadow-[0_20px_48px_rgba(0,0,0,0.45)]"
      >
        <span id={includedHintId} hidden>
          {t('library.picker.inCollection')}
        </span>
        <header className="flex shrink-0 items-center gap-2 py-3 pr-2 pl-4">
          <h2 id={titleId} className="m-0 min-w-0 flex-1 truncate text-lg font-semibold text-lib-text-strong">
            {t('library.picker.title', { name: collection.name })}
          </h2>
          <button type="button" className={iconButton} aria-label={t('common.actions.close')} onClick={close}>
            <CloseIcon className="size-5" />
          </button>
        </header>
        {search}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-lib-border-soft">{list}</div>
        {footer}
      </div>
    </div>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  )
}

function BackArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  )
}
