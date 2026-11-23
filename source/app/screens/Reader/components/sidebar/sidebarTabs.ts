import type { ReaderCapability } from '../../../../components/reader/capabilities'
import type { SidebarTab } from './TocSidebar'
import type { MessageKey } from '@core'

export type SidebarTabDef = {
  id: SidebarTab
  /** Catalogue key (spec 012), translated where shown. */
  labelKey: MessageKey
  /** Shown / openable only when the open book's surface has this capability. */
  requires?: ReaderCapability
}

export const SIDEBAR_TABS: SidebarTabDef[] = [
  { id: 'chapters', labelKey: 'reader.sidebar.tabs.chapters' },
  { id: 'bookmarks', labelKey: 'reader.sidebar.tabs.bookmarks' },
  { id: 'highlights', labelKey: 'reader.sidebar.tabs.highlights' },
  { id: 'layout', labelKey: 'reader.sidebar.tabs.layout', requires: 'pageLayout' },
  { id: 'attachments', labelKey: 'reader.sidebar.tabs.attachments', requires: 'attachments' },
  { id: 'transcript', labelKey: 'reader.sidebar.tabs.transcript', requires: 'transcript' },
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

/** Catalogue keys of the panel titles (spec 012): render with `t(SIDEBAR_TAB_LABEL[tab])`. */
export const SIDEBAR_TAB_LABEL: Record<SidebarTab, MessageKey> = {
  chapters: 'reader.sidebar.tabs.chapters',
  bookmarks: 'reader.sidebar.tabs.bookmarks',
  highlights: 'reader.sidebar.tabs.highlights',
  layout: 'reader.sidebar.tabs.layout',
  attachments: 'reader.sidebar.tabs.attachments',
  transcript: 'reader.sidebar.tabs.transcript',
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
