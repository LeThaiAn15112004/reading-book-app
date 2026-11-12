import type { MessageKey, Translator } from '@core'
import { useFormat, useT, type BoundFormat } from '../../../../i18n'
import { BookCover } from './BookCover'

export type LibraryBookInfoFields = {
  id: string
  title: string
  author?: string
  fileName?: string
  format?: string
  coverUrl?: string
  genre?: string
  genres?: string[]
  fileSizeBytes?: number
  pageCount?: number
  description?: string
  /** Multi-chapter audiobook: its file name and format are those of one chapter, so the rows describe the whole book instead. */
  chapterCount?: number
}

/** Rows shown for a book (dialog + Library table detail panel share them). */
function bookInfoRows(t: Translator, format: BoundFormat, book: LibraryBookInfoFields): Array<[MessageKey, string]> {
  const sizeLabel =
    book.fileSizeBytes != null && book.fileSizeBytes >= 0 ? format.bytes(book.fileSizeBytes) : '—'
  const pagesLabel =
    book.pageCount != null && book.pageCount > 0 ? t('library.pageCount', { count: book.pageCount }) : '—'
  const isMulti = (book.chapterCount ?? 0) > 0
  const formatLabel = isMulti ? t('library.info.audiobook') : book.format?.trim().toUpperCase() || '—'
  const genreLabel =
    book.genre?.trim() ||
    (book.genres && book.genres.length > 0 ? book.genres.join(', ') : undefined) ||
    '—'
  return [
    ['library.info.title', book.title],
    ['library.info.author', book.author?.trim() || '—'],
    ['library.info.format', formatLabel],
    ['library.info.genre', genreLabel],
    ['library.info.size', sizeLabel],
    ['library.info.pages', pagesLabel],
    isMulti
      ? ['library.info.chapters', String(book.chapterCount)]
      : ['library.info.file', book.fileName?.trim() || '—'],
  ]
}

export type LibraryBookInfoContentProps = {
  book: LibraryBookInfoFields
  /** `dialog`: cover beside the fields; `panel`: narrow column, cover on top. */
  variant?: 'dialog' | 'panel'
}

/** Cover + metadata + description — body of the Book info dialog and the table detail panel. */
export function LibraryBookInfoContent({ book, variant = 'dialog' }: LibraryBookInfoContentProps) {
  const t = useT()
  const format = useFormat()
  const formatLabel = book.format?.trim().toUpperCase()
  const isPanel = variant === 'panel'
  const rows = bookInfoRows(t, format, book).filter(([k]) => !(isPanel && k === 'library.info.title'))

  return (
    <>
      <div className={isPanel ? 'flex flex-col gap-4' : 'flex gap-4'}>
        <BookCover
          bookId={book.id}
          title={book.title}
          coverUrl={book.coverUrl}
          format={formatLabel || undefined}
          className={
            isPanel
              ? 'mx-auto h-[180px] w-[128px] shrink-0 rounded-md shadow-md'
              : 'h-[140px] w-[100px] shrink-0 rounded-md shadow-md'
          }
          titleClassName="line-clamp-5 text-[10px] leading-snug font-semibold text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]"
        />
        <dl className="m-0 flex min-w-0 flex-1 flex-col gap-2.5">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[72px_1fr] gap-2 text-[13px]">
              <dt className="m-0 font-semibold text-lib-faint">{t(k)}</dt>
              <dd className="m-0 break-words text-lib-text-strong select-text">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="text-[13px]">
        <div className="mb-1 font-semibold text-lib-faint">{t('library.info.description')}</div>
        <p className="m-0 whitespace-pre-wrap break-words text-lib-text-strong select-text">
          {book.description?.trim() || '—'}
        </p>
      </div>
    </>
  )
}

export type LibraryBookInfoDialogProps = {
  open: boolean
  book: LibraryBookInfoFields | null
  onClose: () => void
}

/** SCR-01a — full book metadata dialog (G1-N7), including cover. */
export function LibraryBookInfoDialog({
  open,
  book,
  onClose,
}: LibraryBookInfoDialogProps) {
  const t = useT()
  if (!open || !book) return null

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-lib-bg-deep/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[480px] flex-col gap-4 rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-xl"
        role="dialog"
        aria-labelledby="library-book-info-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="text-base font-semibold text-lib-text-strong"
          id="library-book-info-title"
        >
          {t('library.info.dialogTitle')}
        </div>

        <LibraryBookInfoContent book={book} />

        <div className="flex justify-end">
          <button
            className="h-10 cursor-pointer rounded-lg border border-lib-accent bg-lib-accent px-4 text-[13px] font-semibold text-lib-on-accent"
            type="button"
            onClick={onClose}
          >
            {t('common.actions.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
