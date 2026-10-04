import { useId, useRef, useState, type KeyboardEvent } from 'react'

export type LibrarySearchBoxProps = {
  value: string
  onChange: (value: string) => void
  /** Recent queries, newest first; pass [] when search history is off. */
  recentSearches: readonly string[]
  /** A search was finished (Enter, leaving the box, or picking a recent one) — record it. */
  onCommit: (query: string) => void
  onRemoveRecent: (query: string) => void
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  )
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

/**
 * Library search input with a "Recent searches" dropdown (combobox). The dropdown opens when the
 * box is focused and empty; ↑/↓ move, Enter picks, Esc closes, × removes one entry.
 */
export function LibrarySearchBox({
  value,
  onChange,
  recentSearches,
  onCommit,
  onRemoveRecent,
}: LibrarySearchBoxProps) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const open = focused && !dismissed && value.trim() === '' && recentSearches.length > 0
  const activeId = open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined

  function pick(query: string) {
    onChange(query)
    onCommit(query)
    setDismissed(true)
    setActiveIndex(-1)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (open && event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => (i + 1) % recentSearches.length)
    } else if (open && event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => (i <= 0 ? recentSearches.length - 1 : i - 1))
    } else if (event.key === 'Enter') {
      if (open && activeIndex >= 0) {
        event.preventDefault()
        pick(recentSearches[activeIndex])
      } else if (value.trim()) {
        onCommit(value)
      }
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      setDismissed(true)
    }
  }

  return (
    <div className="relative min-w-0 max-w-80 flex-1" data-no-drag>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-lib-faint" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        className="h-[38px] w-full rounded-lg border border-lib-border bg-lib-input py-0 pr-3.5 pl-9 text-sm text-lib-text-strong outline-none transition-[border-color,box-shadow] placeholder:text-lib-faint focus:border-lib-accent focus:shadow-[0_0_0_3px_var(--color-lib-accent-soft)]"
        placeholder="Search imported files…"
        aria-label="Search local library"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setDismissed(false)
          setActiveIndex(-1)
        }}
        onFocus={() => {
          setFocused(true)
          setDismissed(false)
        }}
        onBlur={() => {
          setFocused(false)
          setActiveIndex(-1)
          if (value.trim()) onCommit(value)
        }}
        onKeyDown={onKeyDown}
      />

      {open ? (
        <div
          className="absolute top-[calc(100%+6px)] right-0 left-0 z-[60] overflow-hidden rounded-lg border border-lib-border bg-lib-bg-deep py-1 shadow-[var(--lib-overlay-shadow)]"
          data-no-drag
          // Keep focus in the input while clicking inside the dropdown.
          onMouseDown={(e) => e.preventDefault()}
        >
          <p className="m-0 px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-lib-faint uppercase">
            Recent searches
          </p>
          <ul id={listId} role="listbox" aria-label="Recent searches" className="m-0 list-none p-0">
            {recentSearches.map((query, index) => (
              <li
                key={query}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`group flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] ${
                  index === activeIndex
                    ? 'bg-lib-accent-soft text-lib-text-strong'
                    : 'text-lib-text hover:bg-lib-surface-hover'
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => pick(query)}
              >
                <ClockIcon className="size-4 shrink-0 text-lib-faint" />
                <span className="min-w-0 flex-1 truncate">{query}</span>
                <button
                  type="button"
                  tabIndex={-1}
                  className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent text-[12px] text-lib-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-lib-text-strong"
                  aria-label={`Remove “${query}” from recent searches`}
                  title="Remove"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveRecent(query)
                    setActiveIndex(-1)
                    inputRef.current?.focus()
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
