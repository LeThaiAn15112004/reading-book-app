import type { ReactNode } from 'react'
import { READER_FOOTER_HEIGHT_PX } from './sidebarTabs'
import { readerChromeTopInset } from '../../../../reader/readerChromeLayout'

/**
 * Generic right-edge reader panel shell.
 * Content is supplied by callers so many features can share one layout that
 * shrinks the reading area (via ReaderShell paddingRight) instead of overlaying it.
 */
export type RightSidebarPanelProps = {
  open: boolean
  panelWidth: number
  isResizing?: boolean
  chromeHidden?: boolean
  title?: string
  onClose: () => void
  onResizePointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void
  children?: ReactNode
  /** Optional header actions (before the close button). */
  headerActions?: ReactNode
}

export function RightSidebarPanel({
  open,
  panelWidth,
  isResizing = false,
  chromeHidden = true,
  title = 'Panel',
  onClose,
  onResizePointerDown,
  children,
  headerActions,
}: RightSidebarPanelProps) {
  const chromeTopInset = readerChromeTopInset(chromeHidden)

  return (
    <aside
      data-reader-right-sidebar-panel
      className={`@container absolute z-[160] flex flex-col border-y border-l border-lib-border bg-lib-surface-strong shadow-lg ${
        isResizing
          ? ''
          : 'transition-[transform,top] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'
      } ${
        open
          ? 'pointer-events-auto translate-x-0 border-r-0'
          : 'pointer-events-none translate-x-full border-r'
      }`}
      style={{
        right: 0,
        top: chromeTopInset,
        bottom: READER_FOOTER_HEIGHT_PX,
        width: panelWidth,
      }}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between gap-2 border-b border-lib-border-soft px-3 py-2.5">
        <h2 className="m-0 min-w-0 flex-1 truncate text-[15px] font-semibold text-lib-text-strong">
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {headerActions}
          <button
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-base text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong"
            type="button"
            aria-label="Close panel"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>

      {open && onResizePointerDown ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          className="absolute top-0 -left-1 z-[165] w-2 cursor-col-resize touch-none"
          style={{ bottom: 0 }}
          onPointerDown={onResizePointerDown}
        >
          <span
            className={`absolute inset-y-0 left-1 w-px ${
              isResizing ? 'bg-lib-accent' : 'bg-lib-border-soft/80'
            }`}
            aria-hidden
          />
        </div>
      ) : null}
    </aside>
  )
}
