import { placeMenu, type CollectionSummary, type MenuPlacement } from '@core'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useBackClose } from '../../../../hooks/app/useBackClose'
import { useDialogFocus } from '../../../../hooks/app/useDialogFocus'
import { useT } from '../../../../i18n'
import { isMobileHost } from '../../../../platforms/host'

import type { CollectionMenuPoint } from './menuPoint'

export type { CollectionMenuPoint }

export type CollectionItemMenuProps = {
  collection: CollectionSummary
  point: CollectionMenuPoint | null
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}

/**
 * Actions of one collection (spec 015 FR-004, research R3): opened by the ⋮ button, right-click (Desktop) or a
 * long-press (phone), on a card and on the collection page. Desktop: a measured pop-up menu; phone: a bottom sheet with
 * full-width rows. Delete is marked by colour AND its label (FR-003) and always asks for confirmation (FR-006).
 */
export function CollectionItemMenu(props: CollectionItemMenuProps) {
  return isMobileHost() ? <PhoneCollectionSheet {...props} /> : <DesktopCollectionMenu {...props} />
}

/** ArrowUp / ArrowDown / Home / End between the menu's items (FR-016, T044). */
function moveFocus(event: ReactKeyboardEvent<HTMLElement>) {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(event.key)) return
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
  if (items.length === 0) return
  event.preventDefault()
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (at + 1) % items.length
          : (at - 1 + items.length) % items.length
  items[next]?.focus()
}

const desktopItem =
  'flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-2.5 text-left text-[13px] text-lib-text-strong hover:bg-lib-chip focus-visible:bg-lib-chip focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent'
const desktopDanger =
  'flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-2.5 text-left text-[13px] text-lib-danger hover:bg-lib-danger/10 focus-visible:bg-lib-danger/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent'

function DesktopCollectionMenu({ collection, point, onEdit, onDelete, onClose }: CollectionItemMenuProps) {
  const t = useT()
  const menuRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<MenuPlacement | null>(null)
  useDialogFocus(true, menuRef)

  useLayoutEffect(() => {
    const place = () => {
      const menu = menuRef.current
      if (!menu) return
      const at = point ?? { x: window.innerWidth / 2 + menu.offsetWidth / 2, y: window.innerHeight / 3 }
      setPlacement(
        placeMenu({
          x: at.x,
          y: at.y,
          flipY: point?.flipY,
          width: menu.offsetWidth,
          height: menu.scrollHeight,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        }),
      )
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [point])

  useEffect(() => {
    const closeOnPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('pointerdown', closeOnPointer)
    window.addEventListener('keydown', closeOnKey)
    return () => {
      window.removeEventListener('pointerdown', closeOnPointer)
      window.removeEventListener('keydown', closeOnKey)
    }
  }, [onClose])

  function run(action: () => void) {
    onClose()
    action()
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('library.collections.moreActionsAria', { name: collection.name })}
      className="fixed z-[300] w-[200px] rounded-xl border border-lib-border bg-lib-surface-strong p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
      style={
        placement
          ? { left: placement.left, top: placement.top }
          : { left: 0, top: 0, visibility: 'hidden' }
      }
      onKeyDown={moveFocus}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <button type="button" role="menuitem" className={desktopItem} onClick={() => run(onEdit)}>
        <PencilIcon className="size-4 text-lib-muted" />
        {t('library.collections.edit')}
      </button>
      <div className="my-1 border-t border-lib-border-soft" role="separator" />
      <button type="button" role="menuitem" className={desktopDanger} onClick={() => run(onDelete)}>
        <TrashIcon className="size-4" />
        {t('common.actions.delete')}
      </button>
    </div>
  )
}

const sheetItem =
  'flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg border-none bg-transparent px-3 text-left text-[15px] text-lib-text-strong active:bg-lib-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent'

function PhoneCollectionSheet({ collection, onEdit, onDelete, onClose }: CollectionItemMenuProps) {
  const t = useT()
  const sheetRef = useRef<HTMLDivElement>(null)
  // FR-020: the system Back closes the sheet before leaving the page.
  useBackClose(true, onClose)
  useDialogFocus(true, sheetRef)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function run(action: () => void) {
    onClose()
    action()
  }

  return (
    <div className="fixed inset-0 z-[300]">
      <button
        type="button"
        tabIndex={-1}
        className="absolute inset-0 cursor-default border-none bg-black/45"
        aria-label={t('library.phone.sheet.close')}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        role="menu"
        aria-label={t('library.collections.moreActionsAria', { name: collection.name })}
        className="phone-sheet absolute inset-x-0 bottom-0 rounded-t-2xl border border-lib-border bg-lib-surface-strong px-2 pt-2 pb-[calc(8px+var(--app-safe-bottom,env(safe-area-inset-bottom)))] shadow-[var(--lib-overlay-shadow)]"
        onKeyDown={moveFocus}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-lib-border" aria-hidden />
        <p className="m-0 line-clamp-2 px-3 pb-2 text-[15px] font-semibold text-lib-text-strong">{collection.name}</p>
        <div className="my-1 border-t border-lib-border-soft" role="separator" />
        <button type="button" role="menuitem" className={sheetItem} onClick={() => run(onEdit)}>
          <PencilIcon className="size-5 text-lib-muted" />
          {t('library.collections.edit')}
        </button>
        <button
          type="button"
          role="menuitem"
          className={`${sheetItem} mt-2 text-lib-danger`}
          onClick={() => run(onDelete)}
        >
          <TrashIcon className="size-5" />
          {t('common.actions.delete')}
        </button>
      </div>
    </div>
  )
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 2.651 2.651M18.18 3.169a1.875 1.875 0 1 1 2.652 2.652L7.5 19.152l-3.75 1.098 1.098-3.75L18.18 3.169Z" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6.75h15M9.75 6.75V4.5h4.5v2.25m-7.5 0 .75 12.75h9l.75-12.75M10.5 10.5v6m3-6v6" />
    </svg>
  )
}
