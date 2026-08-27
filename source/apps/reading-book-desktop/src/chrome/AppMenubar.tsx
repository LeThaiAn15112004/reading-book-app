import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { flushRegisteredSession } from '../screens/Reader/logic'
import {
  useAppNav,
  type AppNavId,
  type AppStubNavId,
} from './AppNavContext'
import { useOpenReading } from './OpenReadingContext'
import { useReaderChromeMenu } from './ReaderChromeMenuContext'

type NavItem =
  | { id: 'library' | 'settings' | 'reading'; label: string; to?: string }
  | { id: AppStubNavId; label: string }

const PRIMARY_ITEMS: readonly NavItem[] = [
  { id: 'library', label: 'Library', to: '/library' },
  { id: 'collections', label: 'Collections' },
  { id: 'cloud-sources', label: 'Cloud Sources' },
]

type CloudProviderNavId = 'cloud-google-drive' | 'cloud-dropbox' | 'cloud-onedrive'

const CLOUD_PROVIDER_ITEMS: readonly { id: CloudProviderNavId; label: string }[] = [
  { id: 'cloud-google-drive', label: 'Google Drive' },
  { id: 'cloud-dropbox', label: 'Dropbox' },
  { id: 'cloud-onedrive', label: 'OneDrive' },
]

const CLOUD_MENU_CLOSE_DELAY_MS = 300
const CLOUD_MENU_GAP_PX = 4
const CLOUD_MENU_BRIDGE_PX = 8
const TAB_DRAG_MIME = 'application/x-readmate-tab-index'

function itemClass(active: boolean): string {
  return `inline-flex h-8 shrink-0 cursor-pointer items-center rounded-md border-none bg-transparent px-2.5 text-[13px] font-medium whitespace-nowrap no-underline transition-colors ${
    active
      ? 'bg-lib-accent-soft text-lib-accent'
      : 'text-lib-muted hover:bg-lib-accent-soft/60 hover:text-lib-text-strong'
  }`
}

/**
 * "Cloud Sources" tab — opens a dropdown (click or hover) to pick a provider.
 *
 * The menu is `position: fixed` (not `absolute`) because the surrounding
 * `<nav>` scrolls horizontally (`overflow-x-auto`); per the CSS overflow
 * spec that forces its `overflow-y` to compute as `auto` too, which would
 * silently clip an absolutely-positioned popover before it's ever visible.
 */
function CloudSourcesMenuItem({
  active,
  onSelectProvider,
}: {
  active: boolean
  onSelectProvider: (id: CloudProviderNavId) => void
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)

  function cancelClose() {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  function scheduleClose() {
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      if (isPointerInsideMenu()) return
      setOpen(false)
    }, CLOUD_MENU_CLOSE_DELAY_MS)
  }

  function rememberPointer(event: PointerEvent | ReactPointerEvent) {
    lastPointerRef.current = { x: event.clientX, y: event.clientY }
  }

  function containsMenuTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false
    return Boolean(
      wrapperRef.current?.contains(target) ||
        menuRef.current?.contains(target),
    )
  }

  function isPointerInsideMenu(): boolean {
    const point = lastPointerRef.current
    if (!point) return false
    const target = document.elementFromPoint(point.x, point.y)
    return containsMenuTarget(target)
  }

  function openMenu() {
    cancelClose()
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setMenuPos({ left: rect.left, top: rect.bottom + CLOUD_MENU_GAP_PX })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function closeOnPointer(event: PointerEvent) {
      rememberPointer(event)
      if (containsMenuTarget(event.target)) return
      setOpen(false)
    }
    function trackPointer(event: PointerEvent) {
      rememberPointer(event)
      if (containsMenuTarget(event.target)) cancelClose()
    }
    function syncMenuPos() {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (rect) setMenuPos({ left: rect.left, top: rect.bottom + CLOUD_MENU_GAP_PX })
    }
    function closeOnKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', closeOnPointer)
    window.addEventListener('pointermove', trackPointer, true)
    window.addEventListener('resize', syncMenuPos)
    window.addEventListener('scroll', syncMenuPos, true)
    window.addEventListener('keydown', closeOnKey)
    return () => {
      window.removeEventListener('pointerdown', closeOnPointer)
      window.removeEventListener('pointermove', trackPointer, true)
      window.removeEventListener('resize', syncMenuPos)
      window.removeEventListener('scroll', syncMenuPos, true)
      window.removeEventListener('keydown', closeOnKey)
    }
  }, [open])

  useEffect(() => () => cancelClose(), [])

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        data-hover-menu-trigger
        className={itemClass(active)}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerEnter={(e) => {
          rememberPointer(e)
          openMenu()
        }}
        onPointerLeave={(e) => {
          rememberPointer(e)
          scheduleClose()
        }}
        onClick={openMenu}
      >
        Cloud Sources
      </button>
      {open && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label="Cloud Sources providers"
              data-app-menubar-popover
              className="app-menubar-popover app-no-drag fixed z-[1000] w-52 rounded-xl border border-lib-border bg-lib-surface-strong p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
              style={{ left: menuPos.left, top: menuPos.top }}
              onPointerEnter={(e) => {
                rememberPointer(e)
                cancelClose()
              }}
              onPointerLeave={(e) => {
                rememberPointer(e)
                scheduleClose()
              }}
              onPointerMove={rememberPointer}
              onPointerDownCapture={(e) => e.stopPropagation()}
              onMouseDownCapture={(e) => e.stopPropagation()}
            >
              <span
                className="absolute inset-x-0 h-2"
                style={{
                  top: -CLOUD_MENU_BRIDGE_PX,
                  height: CLOUD_MENU_BRIDGE_PX,
                }}
                aria-hidden
              />
              {CLOUD_PROVIDER_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className="flex h-8 w-full cursor-pointer items-center rounded-md border-none bg-transparent px-2.5 text-left text-[13px] text-lib-text-strong transition-colors hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none"
                  onClick={() => {
                    setOpen(false)
                    onSelectProvider(item.id)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

function NavDivider() {
  return (
    <span
      className="mx-1 hidden h-4 w-px shrink-0 bg-lib-border sm:mx-1.5 sm:block"
      aria-hidden
    />
  )
}

function ReadingTabs() {
  const { tabs, activeBookId, focusBook, closeBook, reorderTabs } =
    useOpenReading()
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  if (tabs.length === 0) return null

  function clearDrag() {
    setDragFrom(null)
    setDragOver(null)
  }

  return (
    <div
      className="flex min-h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-lib-border-soft bg-lib-topbar px-3 py-1"
      role="tablist"
      aria-label="Open books"
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragOver(null)
        }
      }}
    >
      {tabs.map((tab, index) => {
        const active = tab.bookId === activeBookId
        const isDragging = dragFrom === index
        const isDropTarget = dragOver === index && dragFrom !== index
        return (
          <div
            key={tab.bookId}
            role="tab"
            aria-selected={active}
            draggable
            onDragStart={(e: DragEvent<HTMLDivElement>) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData(TAB_DRAG_MIME, String(index))
              e.dataTransfer.setData('text/plain', tab.title)
              setDragFrom(index)
            }}
            onDragEnd={clearDrag}
            onDragOver={(e: DragEvent<HTMLDivElement>) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dragOver !== index) setDragOver(index)
            }}
            onDrop={(e: DragEvent<HTMLDivElement>) => {
              e.preventDefault()
              const from = Number.parseInt(
                e.dataTransfer.getData(TAB_DRAG_MIME),
                10,
              )
              if (Number.isFinite(from) && from !== index) {
                reorderTabs(from, index)
              }
              clearDrag()
            }}
            className={`group flex h-7 max-w-[200px] shrink-0 items-center gap-1 rounded-md border px-2 text-[12px] transition-[border-color,background-color,opacity,transform] ${
              active
                ? 'border-lib-accent-ring bg-lib-accent-soft text-lib-accent'
                : 'border-transparent bg-lib-chip/40 text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong'
            } ${isDragging ? 'opacity-45' : ''} ${
              isDropTarget ? 'border-lib-accent ring-1 ring-lib-accent-ring' : ''
            } cursor-grab active:cursor-grabbing`}
          >
            <button
              type="button"
              className="min-w-0 flex-1 cursor-inherit truncate border-none bg-transparent p-0 text-left text-inherit"
              title={`${tab.title} — drag to reorder`}
              onClick={() => focusBook(tab.bookId)}
            >
              {tab.title}
            </button>
            <button
              type="button"
              draggable={false}
              className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent text-[11px] text-lib-faint opacity-70 transition-opacity hover:bg-lib-accent-soft hover:text-lib-text-strong hover:opacity-100 group-hover:opacity-100"
              title={`Close “${tab.title}”`}
              aria-label={`Close ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation()
                void flushRegisteredSession().finally(() => {
                  closeBook(tab.bookId)
                })
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Shared app menubar (replaces the left sidebar). Text-only, below the window titlebar.
 * Hidden on Splash only — visible on Library, Settings, and Reader for fast screen switching.
 */
export function AppMenubar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { libraryNav } = useAppNav()
  const { tabs, goReading } = useOpenReading()
  const { controls: readerChrome } = useReaderChromeMenu()

  const path = location.pathname
  if (path === '/') {
    return null
  }

  const onReading = path.startsWith('/reader')
  const activeId: AppNavId | null = path.startsWith('/settings')
    ? 'settings'
    : onReading
      ? 'reading'
      : (libraryNav?.activeId ?? 'library')

  function handleStub(id: AppStubNavId) {
    void (async () => {
      if (onReading) await flushRegisteredSession()
      if (libraryNav) {
        libraryNav.onStubNav(id)
        return
      }
      navigate('/library', { state: { openNav: id } })
    })()
  }

  function leaveReaderThen(run: () => void) {
    void (async () => {
      if (onReading) await flushRegisteredSession()
      run()
    })()
  }

  function renderItem(item: NavItem) {
    const active = item.id === activeId
    const className = itemClass(active)

    if (item.id === 'cloud-sources') {
      return (
        <CloudSourcesMenuItem
          key={item.id}
          active={active}
          onSelectProvider={(id) => handleStub(id)}
        />
      )
    }

    if (item.id === 'reading') {
      return (
        <button
          key={item.id}
          type="button"
          className={className}
          aria-current={active ? 'page' : undefined}
          title={
            tabs.length === 0
              ? 'Open a book from Library to start reading'
              : `${tabs.length} open book(s)`
          }
          onClick={() => goReading()}
        >
          {item.label}
          {tabs.length > 0 ? (
            <span className="ml-1.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-lib-accent-soft px-1 text-[10px] font-bold text-lib-accent">
              {tabs.length}
            </span>
          ) : null}
        </button>
      )
    }

    if ('to' in item && item.to) {
      if (item.id === 'library' && libraryNav) {
        return (
          <Link
            key={item.id}
            to={item.to}
            className={className}
            aria-current={active ? 'page' : undefined}
            onClick={(e: MouseEvent<HTMLAnchorElement>) => {
              e.preventDefault()
              leaveReaderThen(() => libraryNav.onLibraryNav())
            }}
          >
            {item.label}
          </Link>
        )
      }
      return (
        <Link
          key={item.id}
          to={item.to}
          className={className}
          aria-current={active ? 'page' : undefined}
          onClick={(e: MouseEvent<HTMLAnchorElement>) => {
            if (!onReading) return
            e.preventDefault()
            leaveReaderThen(() => navigate(item.to!))
          }}
        >
          {item.label}
        </Link>
      )
    }

    return (
      <button
        key={item.id}
        type="button"
        className={className}
        onClick={() => handleStub(item.id as AppStubNavId)}
      >
        {item.label}
      </button>
    )
  }


  return (
    <div className="app-menubar-stack">
      <nav
        className="app-menubar flex items-center gap-0.5 overflow-x-auto border-b border-lib-border-soft bg-lib-bg-deep/95 px-3 backdrop-blur-md"
        aria-label="Main navigation"
      >
        {PRIMARY_ITEMS.map(renderItem)}
        <Link
          to="/settings"
          className={itemClass(activeId === 'settings')}
          aria-label="Settings"
          title="Settings"
          onClick={(e: MouseEvent<HTMLAnchorElement>) => {
            if (!onReading) return
            e.preventDefault()
            leaveReaderThen(() => navigate('/settings'))
          }}
        >
          Settings
        </Link>
        {onReading ? (
          <>
            <NavDivider />
            <button
              type="button"
              className={itemClass(!!readerChrome?.toolsOpen)}
              aria-expanded={readerChrome?.toolsOpen ?? false}
              aria-controls="reader-tools-chrome"
              onClick={() => readerChrome?.toggleTools()}
            >
              Tools
            </button>
          </>
        ) : null}
      </nav>
      <ReadingTabs />
    </div>
  )
}
