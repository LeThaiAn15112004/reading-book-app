import { useEffect, useId } from 'react'

export type ImportConflictDialogProps = {
  open: boolean
  /** Optional filename / title hint in the body. */
  message?: string
  onDiscard: () => void
  onOpenExisting: () => void
}

/**
 * UX-IMP conflict — SHA-256 duplicate (BR-03 / T2.7).
 * Discard stays on Library; Open existing navigates to the stored book.
 */
export function ImportConflictDialog({
  open,
  message,
  onDiscard,
  onOpenExisting,
}: ImportConflictDialogProps) {
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDiscard()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onDiscard])

  if (!open) return null

  const body =
    message?.trim() ||
    'This book is already in your local library. Open the existing copy?'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDiscard()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="w-full max-w-[400px] overflow-hidden rounded-xl border border-lib-border bg-lib-surface-strong shadow-[0_20px_48px_rgba(0,0,0,0.45)]"
      >
        <div className="border-b border-lib-border-soft px-6 pt-5 pb-3.5">
          <h2
            id={titleId}
            className="m-0 text-lg font-semibold text-lib-accent"
          >
            File already exists
          </h2>
        </div>

        <div className="px-6 pt-5 pb-6">
          <p
            id={bodyId}
            className="m-0 mb-5 text-sm leading-relaxed text-lib-muted"
          >
            {body}
          </p>
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              className="inline-flex h-[38px] cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-medium text-lib-muted transition-colors hover:text-lib-text-strong"
              onClick={onDiscard}
            >
              Discard
            </button>
            <button
              type="button"
              className="inline-flex h-[38px] cursor-pointer items-center rounded-lg border-none bg-lib-accent px-4 text-[13px] font-semibold text-lib-bg-deep transition-colors hover:bg-lib-accent-hover"
              onClick={onOpenExisting}
            >
              Open existing
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
