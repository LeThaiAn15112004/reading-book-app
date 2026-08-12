import { useState, type DragEvent, type MouseEvent } from 'react'
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
  { id: 'favorites', label: 'Favorites' },
  { id: 'completed', label: 'Completed' },
  { id: 'to-read', label: 'To read' },
  { id: 'collections', label: 'Collections' },
]

const READING_ITEM: NavItem = { id: 'reading', label: 'Reading' }

const CLOUD_ITEMS: readonly NavItem[] = [
  { id: 'cloud-sources', label: 'Cloud Sources' },
]

const FOOTER_ITEMS: readonly NavItem[] = [
  { id: 'settings', label: 'Settings', to: '/settings' },
  { id: 'faq', label: 'FAQ' },
  { id: 'support', label: 'Support' },
  { id: 'about', label: 'About this app' },
  { id: 'privacy', label: 'Privacy policy' },
]

const TAB_DRAG_MIME = 'application/x-readmate-tab-index'

function itemClass(active: boolean): string {
  return `inline-flex h-8 shrink-0 cursor-pointer items-center rounded-md border-none bg-transparent px-2.5 text-[13px] font-medium whitespace-nowrap no-underline transition-colors ${
    active
      ? 'bg-lib-accent-soft text-lib-accent'
      : 'text-lib-muted hover:bg-lib-accent-soft/60 hover:text-lib-text-strong'
  }`
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
        <NavDivider />
        {renderItem(READING_ITEM)}
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
        <NavDivider />
        {CLOUD_ITEMS.map(renderItem)}
        <NavDivider />
        <div className="ml-auto flex items-center gap-0.5">
          {FOOTER_ITEMS.map(renderItem)}
        </div>
      </nav>
      <ReadingTabs />
    </div>
  )
}
