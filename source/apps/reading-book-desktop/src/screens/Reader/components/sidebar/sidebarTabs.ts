import type { ReaderCapability } from '../../../../reader/capabilities'
import type { SidebarTab } from './TocSidebar'

export type SidebarTabDef = {
  id: SidebarTab
  label: string
  icon: string
  /** Shown / openable only when the open book's surface has this capability. */
  requires?: ReaderCapability
}

export const SIDEBAR_TABS: SidebarTabDef[] = [
  { id: 'chapters', label: 'Contents', icon: '📑' },
  { id: 'bookmarks', label: 'Bookmark', icon: '🔖' },
  { id: 'highlights', label: 'Notes', icon: '🖍️' },
  { id: 'layout', label: 'Page layout', icon: '📄', requires: 'pageLayout' },
  { id: 'attachments', label: 'Attachment', icon: '📎' },
]

/** True when `tab` can be shown for a surface with `capabilities`. */
export function isSidebarTabAvailable(
  tab: SidebarTab,
  capabilities: ReadonlySet<ReaderCapability>,
): boolean {
  const def = SIDEBAR_TABS.find((t) => t.id === tab)
  return !!def && (!def.requires || capabilities.has(def.requires))
}

/** Rail entries for the open book — unsupported tabs are hidden, never shown disabled. */
export function sidebarTabsFor(capabilities: ReadonlySet<ReaderCapability>): SidebarTabDef[] {
  return SIDEBAR_TABS.filter((t) => isSidebarTabAvailable(t.id, capabilities))
}

/**
 * The tab to actually show: a selected tab the surface doesn't support (e.g. Page layout left over
 * from a PDF, or a format that resolved after the tab was picked) falls back to Contents.
 */
export function resolveSidebarTab(
  tab: SidebarTab,
  capabilities: ReadonlySet<ReaderCapability>,
): SidebarTab {
  return isSidebarTabAvailable(tab, capabilities) ? tab : 'chapters'
}

export const SIDEBAR_TAB_LABEL: Record<SidebarTab, string> = {
  chapters: 'Contents',
  bookmarks: 'Bookmark',
  highlights: 'Notes',
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
  options?: { hideRail?: boolean },
): number {
  if (options?.hideRail && !open) return 0
  return open
    ? SIDEBAR_RAIL_WIDTH_PX + panelWidth
    : SIDEBAR_RAIL_WIDTH_PX
}

/** Right panel inset — shrinks reading area when open (no icon rail). */
export function sidebarContentInsetRight(
  open: boolean,
  panelWidth: number = SIDEBAR_PANEL_WIDTH_PX,
): number {
  return open ? panelWidth : 0
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
