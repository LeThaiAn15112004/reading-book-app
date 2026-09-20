import { useEffect, useRef } from 'react'

type ReaderSearchPanelProps = {
  open: boolean
  query: string
  onQueryChange: (query: string) => void
  onSubmit: () => void
  onClose: () => void
}

/** UI-only in-book search — opened via the Search tool or Ctrl+F. No search logic yet. */
export function ReaderSearchPanel({
  open,
  query,
  onQueryChange,
  onSubmit,
  onClose,
}: ReaderSearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      className="absolute top-[calc(100%+8px)] left-0 z-[120] flex w-[min(300px,calc(100vw-24px))] items-center gap-2 rounded-xl border border-lib-border bg-lib-surface-strong p-2 shadow-xl backdrop-blur-md"
      role="search"
      onClick={(e) => e.stopPropagation()}
    >
      <form
        className="flex min-w-0 flex-1 items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.8}
          stroke="currentColor"
          className="size-4 shrink-0 text-lib-muted"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"
          />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search in book…"
          aria-label="Search in book"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 border-none bg-transparent text-sm text-lib-text outline-none placeholder:text-lib-muted"
        />
      </form>
      <button
        type="button"
        className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong"
        title="Close search"
        aria-label="Close search"
        onClick={onClose}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.8}
          stroke="currentColor"
          className="size-4"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
