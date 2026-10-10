import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ShortcutId } from '../../../../shortcuts/shortcutDefinitions'
import { useShortcutLabel } from '../../../../shortcuts/useShortcutLabel'

export type ToolGroupMenuItem = {
  id: string
  label: string
  icon: ReactNode
  /** Armed / on — shown highlighted, like a pressed toolbar button. */
  active?: boolean
  shortcutId?: ShortcutId
  onSelect: () => void
}

type ToolGroupMenuProps = {
  /** Trigger label — the group name, or the active item's label when one is armed. */
  label: string
  icon: ReactNode
  /** Highlights the trigger (an item of the group is armed). */
  active?: boolean
  items: ToolGroupMenuItem[]
  buttonClassName: string
  labelClassName: string
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
  'flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg border-none bg-transparent px-3 py-2 text-left text-sm font-medium text-lib-text hover:bg-lib-surface-hover hover:text-lib-text-strong'

/**
 * A toolbar group folded into one button with a dropdown. The menu is portalled and fixed-positioned
 * because the tools strip scrolls horizontally (`overflow-x-auto` would clip an absolute menu).
 */
export function ToolGroupMenu({
  label,
  icon,
  active = false,
  items,
  buttonClassName,
  labelClassName,
}: ToolGroupMenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const menuWidth = menuRef.current?.offsetWidth ?? 240
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8))
    setPos({ left, top: rect.bottom + 8 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      close()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        className={buttonClassName}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={active}
        onClick={() => {
          setPos(null)
          setOpen((v) => !v)
        }}
      >
        {icon}
        <span className={`${labelClassName} inline-flex items-center gap-0.5`}>
          {label}
          <Chevron open={open} />
        </span>
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-[120] flex min-w-[220px] flex-col gap-0.5 rounded-xl border border-lib-border bg-lib-surface-strong p-1.5 shadow-xl backdrop-blur-md"
              style={{
                left: pos?.left ?? 0,
                top: pos?.top ?? 0,
                visibility: pos ? 'visible' : 'hidden',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {items.map((item) => (
                <button
                  key={item.id}
                  className={`${itemClass}${item.active ? ' bg-lib-accent-soft text-lib-accent' : ''}`}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    item.onSelect()
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.shortcutId ? <ShortcutHint id={item.shortcutId} /> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
