import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useDismissOnOutsideOrEscape } from '../../Reader/logic'

export type AudioSelectOption = {
  value: string
  label: string
  /** Not selectable; `hint` says why. */
  disabled?: boolean
  hint?: string
}

const VIEWPORT_MARGIN = 8
const MENU_MAX_HEIGHT = 288
const GAP = 8

const itemClass =
  'flex min-h-9 w-full cursor-pointer items-center justify-between gap-4 rounded-lg px-3 py-1.5 text-left text-sm font-medium text-lib-text transition-colors hover:bg-lib-surface-hover hover:text-lib-text-strong aria-disabled:cursor-not-allowed aria-disabled:opacity-45 aria-disabled:hover:bg-transparent'

/**
 * A dropdown in the app's own style (the read-aloud / More menus): a pill trigger and a portaled,
 * keyboard-operable listbox — the native `<select>` popup cannot be themed. The trigger is a
 * `combobox`, the popup a `listbox` of `option`s (↑ ↓ Home End move, Enter / Space choose, Esc closes).
 * It opens upward when there is more room above the trigger, since the player controls sit low.
 */
export function AudioSelect({
  label,
  ariaLabel,
  value,
  options,
  valueLabel,
  suffix,
  onChange,
}: {
  /** The small caption inside the trigger ("Speed"). */
  label: string
  ariaLabel: string
  value: string
  options: readonly AudioSelectOption[]
  /** What the trigger shows for the current value; defaults to the selected option's label. */
  valueLabel?: string
  /** Extra text after the value, e.g. a running countdown. */
  suffix?: string | null
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])
  const selected = options.find((o) => o.value === value)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-lib-border bg-lib-surface px-3 text-xs font-semibold text-lib-muted transition-colors hover:border-lib-accent-ring hover:bg-lib-surface-hover aria-expanded:border-lib-accent-ring"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span>{label}</span>
        <span className="text-lib-text">{valueLabel ?? selected?.label ?? value}</span>
        {suffix ? <span className="tabular-nums text-lib-accent">{suffix}</span> : null}
        <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <AudioSelectMenu
          id={listId}
          anchorRef={triggerRef}
          ariaLabel={ariaLabel}
          options={options}
          value={value}
          onClose={close}
          onChoose={(next) => {
            onChange(next)
            close()
          }}
        />
      ) : null}
    </>
  )
}

function AudioSelectMenu({
  id,
  anchorRef,
  ariaLabel,
  options,
  value,
  onClose,
  onChoose,
}: {
  id: string
  anchorRef: React.RefObject<HTMLButtonElement | null>
  ariaLabel: string
  options: readonly AudioSelectOption[]
  value: string
  onClose: () => void
  onChoose: (value: string) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; minWidth: number; top?: number; bottom?: number; maxHeight: number } | null>(null)
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
  const initial = Math.max(0, options.findIndex((o) => o.value === value && !o.disabled))
  const [active, setActive] = useState(initial)

  useLayoutEffect(() => {
    const sync = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const below = window.innerHeight - rect.bottom - GAP - VIEWPORT_MARGIN
      const above = rect.top - GAP - VIEWPORT_MARGIN
      const up = above > below && below < MENU_MAX_HEIGHT
      const maxHeight = Math.min(MENU_MAX_HEIGHT, up ? above : below)
      const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), window.innerWidth - Math.max(rect.width, 160) - VIEWPORT_MARGIN)
      setPos(
        up
          ? { left, minWidth: rect.width, bottom: window.innerHeight - rect.top + GAP, maxHeight }
          : { left, minWidth: rect.width, top: rect.bottom + GAP, maxHeight },
      )
    }
    sync()
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [anchorRef])

  useDismissOnOutsideOrEscape(menuRef, onClose, { ignoreRef: anchorRef, consumeEscape: true })

  // Keyboard focus lives on the list so ↑ ↓ work at once.
  useEffect(() => {
    if (pos) menuRef.current?.focus()
  }, [pos])

  const move = (delta: 1 | -1) => {
    const at = enabled.indexOf(active)
    const next = enabled[(Math.max(0, at) + delta + enabled.length) % enabled.length]
    if (next !== undefined) setActive(next)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), move(1))
    else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1))
    else if (e.key === 'Home') (e.preventDefault(), setActive(enabled[0] ?? 0))
    else if (e.key === 'End') (e.preventDefault(), setActive(enabled[enabled.length - 1] ?? 0))
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const o = options[active]
      if (o && !o.disabled) onChoose(o.value)
    } else if (e.key === 'Tab') onClose()
  }

  if (!pos) return null
  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role="listbox"
      tabIndex={-1}
      aria-label={ariaLabel}
      aria-activedescendant={`${id}-${active}`}
      className="fixed z-[400] overflow-y-auto rounded-xl border border-lib-border bg-lib-surface-strong p-1.5 shadow-xl backdrop-blur-md outline-none"
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: Math.max(pos.minWidth, 160), maxHeight: pos.maxHeight }}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((o, i) => {
        const isSelected = o.value === value
        return (
          <div
            key={o.value}
            id={`${id}-${i}`}
            role="option"
            aria-selected={isSelected}
            aria-disabled={o.disabled || undefined}
            title={o.disabled ? o.hint : undefined}
            className={`${itemClass} ${i === active && !o.disabled ? 'bg-lib-surface-hover text-lib-text-strong' : ''} ${isSelected ? '!text-lib-accent' : ''}`}
            onMouseEnter={() => {
              if (!o.disabled) setActive(i)
            }}
            onClick={() => {
              if (!o.disabled) onChoose(o.value)
            }}
          >
            <span>{o.label}</span>
            {isSelected ? (
              <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            ) : null}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
