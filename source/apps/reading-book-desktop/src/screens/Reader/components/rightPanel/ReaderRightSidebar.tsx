import type { ReactNode } from 'react'
import { readerChromeTopInset } from '../../../../reader/chrome'
import { READER_FOOTER_HEIGHT_PX } from '../sidebar/sidebarTabs'
import { RIGHT_SIDEBAR_WIDTH_PX } from './rightSidebarLayout'

type ReaderRightSidebarProps = {
  open: boolean
  title: string
  onClose: () => void
  /** Tools bar hidden — the panel then starts at the top of the reader box. */
  chromeHidden: boolean
  /** False on narrow viewports: the panel overlays the page (full width) instead of docking. */
  docked: boolean
  /** Optional controls rendered next to the title (left of the close button). */
  headerActions?: ReactNode
  children: ReactNode
}

/**
 * Generic docked right sidebar for the reader (SCR-03). It is laid out against the
 * `ReaderShell` box like the left `TocSidebar`; the shell shrinks the reading area by
 * `rightSidebarContentInset`. Content is supplied by the caller, so any feature (reading
 * settings today) can reuse the same frame.
 */
export function ReaderRightSidebar({
  open,
  title,
  onClose,
  chromeHidden,
  docked,
  headerActions,
  children,
}: ReaderRightSidebarProps) {
  return (
    <aside
      data-reader-right-panel
      className={`absolute right-0 z-[160] flex flex-col border-y border-l border-lib-border bg-lib-surface-strong shadow-lg transition-[transform,top] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        open ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      style={{
        top: readerChromeTopInset(chromeHidden),
        bottom: READER_FOOTER_HEIGHT_PX,
        width: docked ? RIGHT_SIDEBAR_WIDTH_PX : '100%',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
      }}
      aria-hidden={!open}
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-lib-border-soft px-4 py-2.5">
        <h2 className="m-0 min-w-0 truncate text-sm font-semibold text-lib-text-strong">
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {headerActions}
          <button
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-lib-muted transition-colors hover:bg-lib-surface-hover hover:text-lib-text-strong"
            type="button"
            title="Close"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6">{children}</div>
    </aside>
  )
}
