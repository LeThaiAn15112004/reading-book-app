import { BookCover } from '../../../Library/components/book/BookCover'
import {
  SIGNATURE_CHECKING,
  SIGNATURE_LABELS,
  SIGNATURE_UNAVAILABLE,
} from '../../logic/bookSignature/signatureLabels'
import { useBookSignature } from '../../logic/hooks/useBookSignature'

type BookInfoDialogProps = {
  open: boolean
  bookId: string
  title: string
  chapterLabel: string
  formatLabel?: string
  coverUrl?: string
  onClose: () => void
}

export function BookInfoDialog({
  open,
  bookId,
  title,
  chapterLabel,
  formatLabel = 'EPUB',
  coverUrl,
  onClose,
}: BookInfoDialogProps) {
  const { signature, loading } = useBookSignature(bookId, open)
  if (!open) return null

  const signatureText = signature
    ? SIGNATURE_LABELS[signature.status].label
    : loading
      ? SIGNATURE_CHECKING
      : SIGNATURE_UNAVAILABLE

  const formatBadge = formatLabel.trim().toUpperCase()

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-lib-bg-deep/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[450px] flex-col gap-4 rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-xl"
        role="dialog"
        aria-labelledby="book-info-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="text-base font-semibold text-lib-text-strong"
          id="book-info-title"
        >
          Book info
        </div>

        <div className="flex gap-4">
          <BookCover
            bookId={bookId}
            title={title}
            coverUrl={coverUrl}
            format={formatBadge}
            className="h-[140px] w-[100px] shrink-0 rounded-md shadow-md"
            titleClassName="line-clamp-5 text-[10px] leading-snug font-semibold text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]"
          />
          <dl className="m-0 flex min-w-0 flex-1 flex-col gap-2.5">
            {(
              [
                ['Title', title],
                ['Location', chapterLabel],
                ['Format', formatBadge],
                ['Signature', signatureText],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[72px_1fr] gap-2 text-[13px]">
                <dt className="m-0 font-semibold text-lib-faint">{k}</dt>
                <dd className="m-0 break-words text-lib-text-strong">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex justify-end">
          <button
            className="h-10 cursor-pointer rounded-lg border border-lib-accent bg-lib-accent px-4 text-[13px] font-semibold text-lib-on-accent"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
