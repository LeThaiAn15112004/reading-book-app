import type { ReaderCapability } from '../../../../reader/capabilities'

/** Toolbar mode buttons. */
export type ModeTool = 'hand' | 'select'

/** Companion actions — UI entry only until later phases. */
export type CompanionTool = 'search' | 'speech' | 'translate'

/** Annotation/markup tools — UI entry only until the rebuild lands. */
export type AnnotationTool = 'highlight' | 'underline' | 'strikethrough' | 'textarea' | 'freehand'

/** Which toolbar section a tool lives in (sections are separated by a divider). */
export type ToolGroupId = 'navigate' | 'annotation'

export type ToolDef = {
  id: ModeTool | CompanionTool | AnnotationTool
  label: string
  group: ToolGroupId
  /** Shown only when the reader has all of these (see `reader/capabilities.ts`). */
  requires?: ReaderCapability[]
}

/** Single source of truth for the tools rendered from a list — order here is toolbar order. */
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
]

export function toolsForGroup(
  group: ToolGroupId,
  capabilities: ReadonlySet<ReaderCapability>,
): ToolDef[] {
  return TOOL_REGISTRY.filter(
    (tool) => tool.group === group && (tool.requires ?? []).every((c) => capabilities.has(c)),
  )
}
