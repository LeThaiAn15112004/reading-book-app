import type { SidebarTab } from './TocSidebar'
import {
  READER_FOOTER_HEIGHT_PX,
  SIDEBAR_RAIL_WIDTH_PX,
  SIDEBAR_TABS,
} from './sidebarTabs'
import { readerChromeTopInset } from '../../../../reader/chrome'

type SidebarEdgeRailProps = {
  open: boolean
  activeTab: SidebarTab
  panelWidth: number
  isResizing?: boolean
  chromeHidden?: boolean
  /** Immersive fullscreen: hide rail until left-edge reveal. */
  immersiveHidden?: boolean
  /** Marks the Bookmark tab when the current place is bookmarked (FR-11). */
  bookmarkActive?: boolean
  onOpenTab: (tab: SidebarTab) => void
  onToggle: () => void
}

export function SidebarEdgeRail({
  open,
  activeTab,
  panelWidth,
  isResizing = false,
  chromeHidden = true,
  immersiveHidden = false,
  bookmarkActive = false,
  onOpenTab,
  onToggle,
}: SidebarEdgeRailProps) {
  const handleLeft = open
    ? SIDEBAR_RAIL_WIDTH_PX + panelWidth
    : SIDEBAR_RAIL_WIDTH_PX
  const chromeTopInset = readerChromeTopInset(chromeHidden)
  const edgeTransition = isResizing
    ? ''
    : 'transition-[top,left,color,border-color,opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'

  // Hard-hide in immersive mode: translate alone leaves the chevron handle
  // peeking (it only shifts by its own width, not the rail offset).
  if (immersiveHidden) return null

  return (
    <>
      <nav
        data-immersive-chrome=""
        className={`absolute left-0 z-[170] flex flex-col items-stretch py-1.5 ${edgeTransition} ${
          open
            ? 'border-r-0 bg-lib-hint/35'
            : 'border-r border-lib-border-soft/50 bg-lib-bg-deep/35'
        } backdrop-blur-sm`}
        style={{
          width: SIDEBAR_RAIL_WIDTH_PX,
          top: chromeTopInset,
          bottom: READER_FOOTER_HEIGHT_PX,
        }}
        aria-label="Sidebar navigation"
      >
        {SIDEBAR_TABS.map((tab) => {
          const isActive = activeTab === tab.id
          const merged = open && isActive
          const bookmarkHint =
            tab.id === 'bookmarks' && bookmarkActive && !isActive

          return (
            <button
              key={tab.id}
              className={`relative mx-0.5 flex h-8 cursor-pointer items-center justify-center border-none text-[15px] leading-none transition-[color,background,box-shadow,opacity] ${
                merged
                  ? 'z-[1] rounded-l-md rounded-r-none border-l-[3px] border-l-lib-accent bg-lib-surface-strong text-lib-accent shadow-[1px_0_0_0_var(--lib-surface-strong)] ring-1 ring-inset ring-lib-accent/35'
                  : isActive
                    ? 'rounded-md border-l-[3px] border-l-lib-accent bg-lib-accent-soft text-lib-accent ring-1 ring-lib-accent-ring/70'
                    : bookmarkHint
                      ? 'rounded-md text-lib-accent/90 hover:bg-lib-bg-deep/45'
                      : 'rounded-md text-lib-muted opacity-65 hover:bg-lib-bg-deep/45 hover:text-lib-text-strong hover:opacity-100'
              }`}
              type="button"
              title={open ? undefined : tab.label}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              aria-pressed={isActive}
              onClick={(e) => {
                e.stopPropagation()
                onOpenTab(tab.id)
              }}
            >
              <span aria-hidden>{tab.icon}</span>
            </button>
          )
        })}
      </nav>

      <button
        data-immersive-chrome=""
        className={`absolute z-[175] flex w-5 cursor-pointer items-center justify-center rounded-r-md border border-l-0 border-lib-border-soft bg-lib-surface-strong text-lib-muted shadow-md hover:border-lib-accent-ring hover:text-lib-accent ${edgeTransition}`}
        style={{
          left: handleLeft,
          top: chromeTopInset,
          bottom: READER_FOOTER_HEIGHT_PX,
        }}
        type="button"
        title={open ? undefined : 'Open sidebar'}
        aria-label={open ? 'Close sidebar' : 'Open sidebar'}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.2}
          stroke="currentColor"
          className="size-3.5"
          aria-hidden
        >
          {open ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5 8.25 12l7.5-7.5"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m8.25 4.5 7.5 7.5-7.5 7.5"
            />
          )}
        </svg>
      </button>
    </>
  )
}
