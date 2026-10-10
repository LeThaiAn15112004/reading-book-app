import type { ReaderCapability } from '../../../../reader/capabilities'
import type { ShortcutId } from '../../../../shortcuts/shortcutDefinitions'

/** Toolbar mode buttons. */
export type ModeTool = 'hand' | 'select'

/** Companion actions — UI entry only until later phases. */
export type CompanionTool = 'search' | 'speech' | 'translate'

/** Annotation/markup tools — UI entry only until the rebuild lands. */
export type AnnotationTool = 'highlight' | 'underline' | 'strikethrough' | 'textarea' | 'freehand'

/** View actions — live in the "View" dropdown. */
export type ViewTool = 'zoomIn' | 'zoomOut' | 'resetZoom' | 'fullscreen'

/** Utility tools — inline while there is room, then collapse into the "Tools" dropdown. */
export type MiscTool = 'snapshot' | 'wordCount'

export type ToolId = ModeTool | CompanionTool | AnnotationTool | ViewTool | MiscTool

/** Which toolbar section a tool lives in (sections are separated by a divider). */
export type ToolGroupId = 'navigate' | 'annotation' | 'view' | 'tools'

export type ToolDef = {
  id: ToolId
  label: string
  group: ToolGroupId
  /** Shown only when the reader has all of these (see `reader/capabilities.ts`). */
  requires?: ReaderCapability[]
  /** Its key is displayed beside the tool in dropdown menus, following the user's customization. */
  shortcutId?: ShortcutId
}

/** Single source of truth for the toolbar's tools — order here is toolbar order. */
export const TOOL_REGISTRY: readonly ToolDef[] = [
  { id: 'hand', label: 'Hand', group: 'navigate' },
  { id: 'select', label: 'Select', group: 'navigate' },
  { id: 'search', label: 'Search', group: 'navigate' },
  { id: 'speech', label: 'Audio', group: 'navigate' },
  { id: 'translate', label: 'Translate', group: 'navigate' },
  { id: 'highlight', label: 'Highlight', group: 'annotation', requires: ['markupAnnotations'] },
  { id: 'underline', label: 'Underline', group: 'annotation', requires: ['markupAnnotations'] },
  { id: 'strikethrough', label: 'Strikethrough', group: 'annotation', requires: ['markupAnnotations'] },
  { id: 'textarea', label: 'Textbox', group: 'annotation', requires: ['freeformAnnotations'] },
  { id: 'freehand', label: 'Freehand', group: 'annotation', requires: ['freeformAnnotations'] },
  { id: 'zoomIn', label: 'Zoom In', group: 'view', requires: ['viewZoom'], shortcutId: 'view.zoomIn' },
  { id: 'zoomOut', label: 'Zoom Out', group: 'view', requires: ['viewZoom'], shortcutId: 'view.zoomOut' },
  { id: 'resetZoom', label: 'Reset Zoom', group: 'view', requires: ['viewZoom'], shortcutId: 'view.resetZoom' },
  { id: 'fullscreen', label: 'Fullscreen', group: 'view', shortcutId: 'view.toggleFullscreen' },
  { id: 'snapshot', label: 'Snapshot', group: 'tools' },
  { id: 'wordCount', label: 'Word Count', group: 'tools' },
]

export function toolsForGroup(
  group: ToolGroupId,
  capabilities: ReadonlySet<ReaderCapability>,
): ToolDef[] {
  return TOOL_REGISTRY.filter(
    (tool) => tool.group === group && (tool.requires ?? []).every((c) => capabilities.has(c)),
  )
}
