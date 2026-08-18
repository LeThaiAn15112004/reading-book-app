import { useEffect, useState, type FormEvent } from 'react'
import type { LibraryBook } from '@reading-book/shared/models'

export type BookMetadataValues = {
  id: string
  title: string
  author?: string
  genres?: string[]
  description?: string
  pageCount?: number
}

export type EditBookMetadataDialogProps = {
  book: LibraryBook | null
  onClose: () => void
  onSave: (values: BookMetadataValues) => void | Promise<void>
}

const inputClass =
  'h-10 w-full rounded-lg border border-lib-border bg-lib-input px-3 text-[13px] text-lib-text-strong outline-none focus:border-lib-accent'

export function EditBookMetadataDialog({
  book,
  onClose,
  onSave,
}: EditBookMetadataDialogProps) {
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [genres, setGenres] = useState('')
  const [description, setDescription] = useState('')
  const [pageCount, setPageCount] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!book) return
    setTitle(book.title)
    setAuthor(book.author === '—' ? '' : book.author)
    setGenres(book.genres?.join(', ') ?? '')
    setDescription(book.description ?? '')
    setPageCount(book.pageCount?.toString() ?? '')
    setSaving(false)
  }, [book])

  if (!book) return null

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle || saving || !book) return
    setSaving(true)
    try {
      const pages = Number.parseInt(pageCount, 10)
      await onSave({
        id: book.id,
        title: trimmedTitle,
        author: author.trim() || undefined,
        genres: genres
          .split(',')
          .map((genre) => genre.trim())
          .filter(Boolean),
        description: description.trim() || undefined,
        pageCount: Number.isFinite(pages) && pages > 0 ? pages : undefined,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[310] flex items-center justify-center bg-lib-bg-deep/65 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        className="flex max-h-[90vh] w-full max-w-[520px] flex-col gap-4 overflow-y-auto rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-book-metadata-title"
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="edit-book-metadata-title" className="m-0 text-base font-semibold text-lib-text-strong">
          Edit metadata
        </h2>
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-lib-muted">
          Title
          <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-lib-muted">
          Author
          <input className={inputClass} value={author} onChange={(event) => setAuthor(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-lib-muted">
          Genres <span className="font-normal text-lib-faint">(comma separated)</span>
          <input className={inputClass} value={genres} onChange={(event) => setGenres(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-lib-muted">
          Pages
          <input className={inputClass} inputMode="numeric" value={pageCount} onChange={(event) => setPageCount(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-lib-muted">
          Description
          <textarea
            className="min-h-24 w-full resize-y rounded-lg border border-lib-border bg-lib-input px-3 py-2.5 text-[13px] text-lib-text-strong outline-none focus:border-lib-accent"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="h-10 cursor-pointer rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-muted" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!title.trim() || saving} className="h-10 cursor-pointer rounded-lg border border-lib-accent bg-lib-accent px-4 text-[13px] font-semibold text-lib-on-accent disabled:cursor-default disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
