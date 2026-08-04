import { useEffect, useRef, useState } from 'react'

type NoteModalProps = {
  open: boolean
  quote: string
  /** Prefill when editing an existing highlight note. */
  initialContent?: string
  title?: string
  /** Allow persisting an empty string (clears the note). */
  allowEmpty?: boolean
  onClose: () => void
  /** Silent auto-save — called on debounce and when closing. */
  onAutosave: (content: string) => void
}

/**
 * Note editor with silent autosave (no manual Save).
 * Closing / Done flushes the latest draft.
 */
export function NoteModal({
  open,
  quote,
  initialContent = '',
  title = 'Add note',
  allowEmpty = false,
  onClose,
  onAutosave,
}: NoteModalProps) {
  const [content, setContent] = useState('')
  const contentRef = useRef(content)
  contentRef.current = content
  const onAutosaveRef = useRef(onAutosave)
  onAutosaveRef.current = onAutosave
  const allowEmptyRef = useRef(allowEmpty)
  allowEmptyRef.current = allowEmpty

  useEffect(() => {
    if (open) setContent(initialContent)
  }, [open, quote, initialContent])

  // Debounced autosave while typing.
  useEffect(() => {
    if (!open) return
    const trimmed = content.trim()
    if (!trimmed && !allowEmpty) return
    const timer = window.setTimeout(() => {
      onAutosaveRef.current(trimmed)
    }, 450)
    return () => window.clearTimeout(timer)
  }, [content, open, allowEmpty])

  function flushAndClose() {
    const trimmed = contentRef.current.trim()
    if (trimmed || allowEmptyRef.current) {
      onAutosaveRef.current(trimmed)
    }
    onClose()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-lib-bg-deep/60 p-4 backdrop-blur-sm"
      onClick={flushAndClose}
    >
      <div
        className="flex w-full max-w-[450px] flex-col gap-4 rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-xl"
        role="dialog"
        aria-labelledby="note-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="text-base font-semibold text-lib-text-strong"
          id="note-modal-title"
        >
          {title}
        </div>
        {quote ? (
          <div className="border-l-[3px] border-lib-accent pl-2.5 font-serif text-sm leading-snug text-lib-muted italic">
            “{quote}”
          </div>
        ) : null}
        <textarea
          className="box-border h-[100px] w-full resize-none rounded-lg border border-lib-border bg-lib-input p-2.5 text-[15px] text-lib-text-strong outline-none focus:border-lib-accent"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write your note… (auto-saves)"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              flushAndClose()
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-lib-faint">Autosaved</span>
          <button
            className="h-10 cursor-pointer rounded-lg border border-lib-accent bg-lib-accent px-4 text-[13px] font-semibold text-lib-on-accent"
            type="button"
            onClick={flushAndClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
