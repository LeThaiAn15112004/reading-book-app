import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { uiText, useT, type UiText } from '../../i18n'

const FORMAT_TAGS = ['EPUB', 'PDF', 'TXT', 'MD'] as const

export type ImportUrlDialogProps = {
  open: boolean
  onClose: () => void
  /** Called with a validated https URL; parent owns IPC / download. */
  onSubmit: (url: string) => void
  /** Pre-filled URL (kept after a failed download). */
  initialUrl?: string
  /** Error from the last download attempt; `retryable` turns the submit button into Retry. */
  submitError?: { message: UiText; retryable: boolean } | null
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
      />
    </svg>
  )
}

/** UX-IMP idle — desktop modal to paste a direct HTTPS file URL (FR-13 / T2.2). */
export function ImportUrlDialog({
  open,
  onClose,
  onSubmit,
  initialUrl = '',
  submitError = null,
}: ImportUrlDialogProps) {
  const t = useT()
  const titleId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState<UiText | null>(null)

  useEffect(() => {
    if (!open) return
    setUrl(initialUrl)
    setError(submitError?.message ?? null)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open, initialUrl, submitError])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  // Retry only while the failed URL is still in the box and the error is still shown.
  const isRetry =
    submitError?.retryable === true && error !== null && url.trim() === initialUrl.trim()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return
    if (!trimmed.toLowerCase().startsWith('https://')) {
      setError({ key: 'import.url.httpsOnly' })
      return
    }
    setError(null)
    onSubmit(trimmed)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-[460px] overflow-hidden rounded-xl border border-lib-border bg-lib-surface-strong shadow-[0_20px_48px_rgba(0,0,0,0.45)]"
      >
        <div className="flex items-center justify-between border-b border-lib-border-soft px-6 pt-5 pb-3.5">
          <h2
            id={titleId}
            className="m-0 text-lg font-semibold text-lib-text-strong"
          >
            {t('import.url.title')}
          </h2>
          <button
            type="button"
            aria-label={t('common.actions.close')}
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-lib-faint transition-colors hover:bg-white/5 hover:text-lib-text-strong"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form className="px-6 pt-5 pb-6" onSubmit={handleSubmit}>
          <div className="mb-4 flex flex-col gap-2">
            <label
              htmlFor="import-url-input"
              className="text-[11px] font-semibold tracking-[0.1em] text-lib-faint uppercase"
            >
              {t('import.url.linkLabel')}
            </label>
            <div className="relative flex items-center">
              <LinkIcon className="pointer-events-none absolute left-3 size-4 text-lib-faint" />
              <input
                ref={inputRef}
                id="import-url-input"
                type="url"
                autoComplete="off"
                value={url}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => {
                  setUrl(e.target.value)
                  if (error) setError(null)
                }}
                className="h-[42px] w-full rounded-lg border border-lib-border bg-[rgba(15,23,42,0.45)] py-0 pr-3.5 pl-[38px] text-sm text-lib-text-strong outline-none transition-[border-color,box-shadow] placeholder:text-lib-faint focus:border-lib-accent focus:shadow-[0_0_0_3px_var(--color-lib-accent-soft)]"
                // i18n-ignore: example URL, not interface text
                placeholder="https://example.com/book.epub"
              />
            </div>
            {error ? (
              <p
                id={errorId}
                className="m-0 text-[13px] text-red-400"
                role="alert"
              >
                {uiText(t, error)}
              </p>
            ) : null}
            <div className="mt-1 flex flex-wrap gap-1.5">
              {FORMAT_TAGS.map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-lib-border-soft bg-[rgba(51,65,85,0.22)] px-1.5 py-0.5 text-[9px] font-bold text-lib-faint"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2.5">
            <button
              type="button"
              className="inline-flex h-[38px] cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-medium text-lib-muted transition-colors hover:text-lib-text-strong"
              onClick={onClose}
            >
              {t('common.actions.cancel')}
            </button>
            <button
              type="submit"
              className="inline-flex h-[38px] cursor-pointer items-center rounded-lg border-none bg-lib-accent px-4 text-[13px] font-semibold text-lib-bg-deep transition-colors hover:bg-lib-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!url.trim()}
            >
              {isRetry ? t('common.actions.retry') : t('import.url.download')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
