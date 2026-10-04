import { useEffect, useId, useState } from 'react'

/** One kind of history the dialog can clear. Add entries here as more history types exist. */
export type ClearDataOption = {
  id: string
  label: string
  /** Short state line, e.g. "5 saved searches". */
  detail: string
  /** Nothing to clear → the box is shown but disabled. */
  empty: boolean
}

export type ClearDataDialogProps = {
  options: readonly ClearDataOption[]
  onCancel: () => void
  onClear: (ids: string[]) => void
}

/**
 * Privacy → Clear Data: the user picks which history to remove. Only user-generated history is
 * listed — never books, annotations, collections, reading progress, the search index or
 * translation models.
 */
export function ClearDataDialog({ options, onCancel, onClear }: ClearDataDialogProps) {
  const titleId = useId()
  const descId = useId()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      className="fixed inset-0 z-[310] flex items-center justify-center bg-lib-bg-deep/65 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[440px] rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="m-0 text-base font-semibold text-lib-text-strong">
          Clear Data
        </h2>
        <p className="m-0 mt-1 text-[13px] text-lib-muted">Choose what you want to remove.</p>

        <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
          {options.map((option) => (
            <li key={option.id}>
              <label
                className={`flex items-start gap-3 rounded-lg border border-lib-border-soft px-3 py-2.5 ${
                  option.empty ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-lib-border'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--lib-accent)] disabled:cursor-not-allowed"
                  checked={selected.has(option.id)}
                  disabled={option.empty}
                  onChange={() => toggle(option.id)}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-lib-text-strong">
                    {option.label}
                  </span>
                  <span className="block text-[12px] text-lib-faint">{option.detail}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <p id={descId} className="m-0 mt-4 text-[12px] leading-relaxed text-lib-muted">
          This will not delete your books, annotations, collections, reading progress, search index
          or translation models.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="h-10 cursor-pointer rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-muted hover:text-lib-text-strong"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="h-10 cursor-pointer rounded-lg border border-red-500 bg-red-500 px-4 text-[13px] font-semibold text-white hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={selected.size === 0}
            onClick={() => onClear([...selected])}
          >
            Clear Selected
          </button>
        </div>
      </div>
    </div>
  )
}
