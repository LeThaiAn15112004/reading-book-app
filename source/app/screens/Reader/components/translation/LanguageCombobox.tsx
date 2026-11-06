import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  TRANSLATION_LANGUAGES,
  findTranslationLanguage,
  searchTranslationLanguages,
  type TranslationLanguage,
} from '@reading-book/book-reader-sdk'

type LanguageComboboxProps = {
  /** Accessible name, e.g. "Translate from". */
  label: string
  value: string
  onChange: (code: string) => void
  /** Shown as a "Recent" group above the full list while the search box is empty. */
  recentCodes?: readonly string[]
  /** Lets the popover know a list is open, so Escape closes the list rather than the popover. */
  onOpenChange?: (open: boolean) => void
  align?: 'left' | 'right'
}

type OptionRow = { key: string; language: TranslationLanguage; group: 'recent' | 'all' }

/**
 * Select-with-search (WAI-ARIA combobox + listbox): the trigger shows the current language;
 * opening it focuses a filter box. Typing filters by English name, endonym or code, accent-
 * insensitively ("tieng" finds Tiếng Việt). ↑/↓/Home/End move, Enter picks, Escape/Tab close.
 *
 * Open/query/active-row state is per-instance widget state (two of these sit side by side in the
 * popover), so it stays local rather than in the translation store.
 */
export function LanguageCombobox({
  label,
  value,
  onChange,
  recentCodes = [],
  onOpenChange,
  align = 'left',
}: LanguageComboboxProps) {
  const id = useId()
  const listboxId = `${id}-listbox`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange

  const current = findTranslationLanguage(value)

  const rows = useMemo<OptionRow[]>(() => {
    const matches = searchTranslationLanguages(query, TRANSLATION_LANGUAGES)
    if (query.trim()) return matches.map((language) => ({ key: `all-${language.code}`, language, group: 'all' }))
    const recent = recentCodes
      .map((code) => findTranslationLanguage(code))
      .filter((language): language is TranslationLanguage => !!language)
    return [
      ...recent.map((language) => ({ key: `recent-${language.code}`, language, group: 'recent' as const })),
      ...matches.map((language) => ({ key: `all-${language.code}`, language, group: 'all' as const })),
    ]
  }, [query, recentCodes])

  const setOpenState = (next: boolean) => {
    setOpen(next)
    onOpenChangeRef.current?.(next)
  }

  // `query` is reset on every close, so `rows` here is already the unfiltered list.
  const openList = () => {
    const selected = rows.findIndex((row) => row.group === 'all' && row.language.code === value)
    setActiveIndex(Math.max(0, selected))
    setOpenState(true)
  }

  const closeList = (restoreFocus: boolean) => {
    setOpenState(false)
    setQuery('')
    if (restoreFocus) triggerRef.current?.focus()
  }

  const pick = (row: OptionRow | undefined) => {
    if (!row) return
    closeList(true)
    onChange(row.language.code)
  }

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // A click anywhere else closes the list (the popover's own outside-dismiss only covers
  // clicks outside the whole popover). Registered only while open; removed on close/unmount.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
      setQuery('')
      onOpenChangeRef.current?.(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  // Unmounting with the list open must not leave the parent thinking it's still open.
  useEffect(() => () => onOpenChangeRef.current?.(false), [])

  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = rows.length - 1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((i) => (i >= last ? 0 : i + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((i) => (i <= 0 ? last : i - 1))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(last)
        break
      case 'Enter':
        event.preventDefault()
        pick(rows[activeIndex])
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        closeList(true)
        break
      case 'Tab':
        closeList(false)
        break
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        ref={triggerRef}
        type="button"
        className="flex h-8 w-full cursor-pointer items-center justify-between gap-1 rounded-lg border border-lib-border bg-lib-bg-mid/40 px-2.5 text-left text-[12px] font-semibold text-lib-text-strong transition-colors hover:border-lib-accent-ring focus-visible:border-lib-accent focus-visible:outline-none"
        aria-label={`${label}: ${current?.name ?? value}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeList(true) : openList())}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            openList()
          }
        }}
      >
        <span className="truncate">{current?.name ?? value}</span>
        <svg className="size-3.5 shrink-0 text-lib-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" />
        </svg>
      </button>

      {open ? (
        <div
          className={`absolute top-[calc(100%+4px)] z-10 flex w-[240px] flex-col overflow-hidden rounded-xl border border-lib-border bg-lib-surface-strong shadow-xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="border-b border-lib-border-soft p-1.5">
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              className="h-8 w-full rounded-md border border-lib-border bg-lib-bg-mid/40 px-2.5 text-[12px] text-lib-text-strong placeholder:text-lib-faint focus:border-lib-accent focus:outline-none"
              placeholder="Search languages…"
              aria-label={`${label} — search`}
              aria-autocomplete="list"
              aria-expanded
              aria-controls={listboxId}
              aria-activedescendant={rows[activeIndex] ? `${id}-${rows[activeIndex].key}` : undefined}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={onInputKeyDown}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={label}
            className="max-h-[220px] overflow-y-auto p-1"
          >
            {rows.length === 0 ? (
              <li className="px-2.5 py-2 text-[12px] text-lib-muted" role="presentation">
                No language matches “{query}”
              </li>
            ) : null}
            {rows.map((row, index) => {
              const showHeader = index === 0 || rows[index - 1]?.group !== row.group
              const selected = row.language.code === value
              const active = index === activeIndex
              return (
                <li key={row.key} role="presentation">
                  {showHeader && !query.trim() ? (
                    <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold tracking-wider text-lib-faint uppercase">
                      {row.group === 'recent' ? 'Recent' : 'All languages'}
                    </div>
                  ) : null}
                  <div
                    id={`${id}-${row.key}`}
                    data-index={index}
                    role="option"
                    aria-selected={selected}
                    className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] ${
                      active ? 'bg-lib-accent-soft text-lib-text-strong' : 'text-lib-text'
                    }`}
                    // Keep focus in the search box so the keyboard keeps working after a hover.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => {
                      if (!active) setActiveIndex(index)
                    }}
                    onClick={() => pick(row)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-semibold">{row.language.name}</span>
                      {row.language.nativeName !== row.language.name ? (
                        <span className="ml-1.5 text-lib-muted">{row.language.nativeName}</span>
                      ) : null}
                    </span>
                    {selected ? (
                      <svg className="size-3.5 shrink-0 text-lib-accent" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                        <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.79 6.8-6.8a1 1 0 0 1 1.4 0Z" />
                      </svg>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
