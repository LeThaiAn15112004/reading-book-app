import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import type { ShortcutId } from '../../../../shortcuts/shortcutDefinitions'
import { useShortcutLabel } from '../../../../shortcuts/useShortcutLabel'
import { useDismissOnOutsideOrEscape } from '../../logic/highlights/useDismissOnOutsideOrEscape'

export type ToolGroupMenuItem = {
  id: string
  label: string
  icon: ReactNode
  /** Armed / on. `undefined` = a plain action (no checked state). */
  active?: boolean
  shortcutId?: ShortcutId
  onSelect: () => void
}

type ToolGroupMenuProps = {
  /** Trigger label — the group name, or the armed item's label when one is on. */
  label: string
  icon: ReactNode
  /** Tooltip for the trigger. */
  title: string
  /** An item of the group is armed — the trigger shows it with the accent style. */
  active?: boolean
  items: ToolGroupMenuItem[]
  buttonClassName: string
  labelClassName: string
  /** Toolbar is hidden (immersive / chrome toggled off) — close and stay closed. */
  hidden?: boolean
}

function ShortcutHint({ id }: { id: ShortcutId }) {
  const label = useShortcutLabel(id)
  return <span className="ml-auto pl-6 text-xs text-lib-muted">{label}</span>
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

const itemClass =
  'flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg border-none bg-transparent px-3 py-2 text-left text-sm font-medium text-lib-text outline-none hover:bg-lib-surface-hover hover:text-lib-text-strong focus-visible:bg-lib-surface-hover focus-visible:text-lib-text-strong'

const itemActiveClass = ' bg-lib-accent-soft text-lib-accent hover:text-lib-accent'

/**
 * A toolbar group folded into one button with a dropdown. The menu is portalled and fixed-positioned
 * because the tools strip scrolls horizontally (`overflow-x-auto` would clip an absolute menu).
 */
export function ToolGroupMenu({
  label,
  icon,
  title,
  active = false,
  items,
  buttonClassName,
  labelClassName,
  hidden = false,
}: ToolGroupMenuProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  // Hiding the toolbar closes the menu (state adjusted during render, not in an effect).
  const [prevHidden, setPrevHidden] = useState(hidden)
  if (hidden !== prevHidden) {
    setPrevHidden(hidden)
    if (hidden) setOpen(false)
  }

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }, [])

  const showMenu = open && !hidden

  return (
    <>
      <button
        ref={buttonRef}
        className={buttonClassName}
        type="button"
        title={title}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={showMenu}
        data-active={active || undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        <span className={`${labelClassName} inline-flex items-center gap-0.5`}>
          {label}
          <Chevron open={showMenu} />
        </span>
      </button>
      {showMenu
        ? createPortal(
            <ToolGroupMenuPopup items={items} anchorRef={buttonRef} onClose={close} />,
            document.body,
          )
        : null}
    </>
  )
}

function ToolGroupMenuPopup({
  items,
  anchorRef,
  onClose,
}: {
  items: ToolGroupMenuItem[]
  anchorRef: RefObject<HTMLButtonElement | null>
  onClose: (refocus: boolean) => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Escape is consumed so the reader's own Escape chain (disarm tool / hide chrome) doesn't also run;
  // outside clicks include the EPUB iframe documents.
  const onDismiss = useCallback(
    (reason: 'escape' | 'outside') => onClose(reason === 'escape'),
    [onClose],
  )
  useDismissOnOutsideOrEscape(menuRef, onDismiss, { ignoreRef: anchorRef, consumeEscape: true })

  useLayoutEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    const menu = menuRef.current
    if (!rect || !menu) return
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))
    setPos({ left, top: rect.bottom + 8 })
    menu.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus({ preventScroll: true })
  }, [anchorRef])

  useLayoutEffect(() => {
    const dismiss = () => onClose(false)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
    }
  }, [onClose])

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [],
    )
    if (buttons.length === 0) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next = -1
    if (e.key === 'ArrowDown') next = (index + 1) % buttons.length
    else if (e.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = buttons.length - 1
    else if (e.key === 'Tab') onClose(false)
    if (next >= 0) {
      e.preventDefault()
      buttons[next].focus()
    }
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[120] flex max-h-[60vh] min-w-[220px] flex-col gap-0.5 overflow-y-auto rounded-xl border border-lib-border bg-lib-surface-strong p-1.5 shadow-xl backdrop-blur-md"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.id}
          className={`${itemClass}${item.active ? itemActiveClass : ''}`}
          type="button"
          role={item.active === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.active}
          onClick={() => {
            onClose(false)
            item.onSelect()
          }}
        >
          {item.icon}
          <span>{item.label}</span>
          {item.shortcutId ? <ShortcutHint id={item.shortcutId} /> : null}
        </button>
      ))}
    </div>
  )
}
