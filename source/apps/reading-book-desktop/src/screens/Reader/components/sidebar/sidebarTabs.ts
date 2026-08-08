import type { SidebarTab } from './TocSidebar'

export const SIDEBAR_TABS: {
  id: SidebarTab
  label: string
  icon: string
}[] = [
  { id: 'chapters', label: 'Contents', icon: '📑' },
  { id: 'bookmarks', label: 'Bookmark', icon: '🔖' },
  { id: 'notes', label: 'Note', icon: '📝' },
  { id: 'layout', label: 'Page layout', icon: '📄' },
  { id: 'attachments', label: 'Attachment', icon: '📎' },
]

export const SIDEBAR_TAB_LABEL: Record<SidebarTab, string> = {
  chapters: 'Contents',
  bookmarks: 'Bookmark',
  notes: 'Note',
  layout: 'Page layout',
  attachments: 'Attachment',
}

/** Icon rail only — panel sits flush on the right edge. */
export const SIDEBAR_RAIL_WIDTH_PX = 36

export const SIDEBAR_PANEL_WIDTH_PX = 272

export const SIDEBAR_PANEL_MIN_WIDTH_PX = 220

export const SIDEBAR_PANEL_MAX_WIDTH_PX = 520

/** Matches ReaderFooter `h-10` — sidebar/rail must stop above this. */
export const READER_FOOTER_HEIGHT_PX = 40

/** Reading viewport inset — rail always; panel added when sidebar is open. */
export function sidebarContentInsetLeft(
  open: boolean,
  panelWidth: number = SIDEBAR_PANEL_WIDTH_PX,
): number {
  return open
    ? SIDEBAR_RAIL_WIDTH_PX + panelWidth
    : SIDEBAR_RAIL_WIDTH_PX
}

export function clampSidebarPanelWidth(
  width: number,
  viewportWidth: number = typeof window !== 'undefined' ? window.innerWidth : 1280,
): number {
  const maxByViewport = Math.max(
    SIDEBAR_PANEL_MIN_WIDTH_PX,
    Math.floor(viewportWidth * 0.55 - SIDEBAR_RAIL_WIDTH_PX),
  )
  const max = Math.min(SIDEBAR_PANEL_MAX_WIDTH_PX, maxByViewport)
  return Math.min(max, Math.max(SIDEBAR_PANEL_MIN_WIDTH_PX, Math.round(width)))
}
