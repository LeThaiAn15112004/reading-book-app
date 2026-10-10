import type { ReaderCapability } from '../../../../reader/capabilities'
import type { ShortcutId } from '../../../../shortcuts/shortcutDefinitions'

/**
 * Single source of truth for the Reader toolbar: which tools exist, which group each belongs to, what
 * the reader surface must support for it to show, and how groups fold on a narrow window.
 * See docs/implementation_plan/reader_toolbar.md.
 */

/** Toolbar mode buttons. */
export type ModeTool = 'hand' | 'select'

/** Companion actions next to the modes. */
export type CompanionTool = 'search' | 'speech' | 'translate'

/** Markup tools — armed one at a time, sticky until toggled off / Escape / Hand / Select. */
export type AnnotationTool = 'highlight' | 'underline' | 'strikethrough'

/** Utility tools. */
export type MiscTool = 'snapshot' | 'wordCount'

export type ToolId = ModeTool | CompanionTool | AnnotationTool | MiscTool | 'settings'

export type ToolGroupId = 'navigate' | 'annotation' | 'view' | 'tools' | 'settings'

/** Icon names understood by `ToolIcon` — every tool id plus the group triggers. */
export type ToolIconId = ToolId | 'view' | 'tools'

export type ToolDef = {
  id: ToolId
  label: string
  group: ToolGroupId
  /** Tooltip text when the label alone isn't self-explanatory. */
  description?: string
  /** Shown only when the reader surface has all of these (see `reader/capabilities.ts`). */
  requires: readonly ReaderCapability[]
  /** Its key is shown in the tooltip and in dropdowns, following the user's customization. */
  shortcutId?: ShortcutId
  /** The button opens a menu / panel (sets `aria-haspopup` + `aria-expanded`). */
  popup?: 'menu' | 'dialog'
}

export type ToolGroupDef = {
  id: ToolGroupId
  label: string
  icon: ToolIconId
  /** `never`: always inline (frequent tools). `auto`: inline until the strip runs out of room. */
  collapse: 'never' | 'auto'
}

/** Toolbar order. Empty groups (nothing supported by the surface) are not rendered. */
export const TOOL_GROUPS: readonly ToolGroupDef[] = [
  { id: 'navigate', label: 'Navigate', icon: 'hand', collapse: 'never' },
  { id: 'annotation', label: 'Annotation', icon: 'highlight', collapse: 'auto' },
  { id: 'view', label: 'View', icon: 'view', collapse: 'auto' },
  { id: 'tools', label: 'Tools', icon: 'tools', collapse: 'auto' },
  { id: 'settings', label: 'Settings', icon: 'settings', collapse: 'never' },
]

/** A group with more tools than this is always a dropdown. */
export const INLINE_MAX = 4

/** Order `auto` groups fold into dropdowns when the strip overflows — least used first. */
export const FOLD_ORDER: readonly ToolGroupId[] = ['tools', 'view', 'annotation']

/** Order within a group is toolbar / menu order. */
export const TOOL_REGISTRY: readonly ToolDef[] = [
  { id: 'hand', label: 'Hand', group: 'navigate', description: 'Hand — pan and turn pages', requires: ['interaction'] },
  { id: 'select', label: 'Select', group: 'navigate', description: 'Select text', requires: ['interaction'] },
  { id: 'search', label: 'Search', group: 'navigate', description: 'Search in book', requires: ['search'], shortcutId: 'general.searchBook' },
  { id: 'speech', label: 'Audio', group: 'navigate', description: 'Read aloud', requires: ['readAloud'], popup: 'menu' },
  { id: 'translate', label: 'Translate', group: 'navigate', description: 'Translate selected text', requires: ['translate'] },
  { id: 'highlight', label: 'Highlight', group: 'annotation', description: 'Highlight — drag over text', requires: ['markupAnnotations'] },
  { id: 'underline', label: 'Underline', group: 'annotation', description: 'Underline — drag over text', requires: ['markupAnnotations'] },
  { id: 'strikethrough', label: 'Strikethrough', group: 'annotation', description: 'Strikethrough — drag over text', requires: ['markupAnnotations'] },
  { id: 'snapshot', label: 'Snapshot', group: 'tools', description: 'Snapshot — copy an area as an image', requires: ['snapshot'] },
  { id: 'wordCount', label: 'Word Count', group: 'tools', description: 'Word count and reading time', requires: ['wordCount'] },
  { id: 'settings', label: 'Settings', group: 'settings', description: 'Reading settings', requires: ['readingSettings'], popup: 'dialog' },
]

export function toolsForGroup(
  group: ToolGroupId,
  capabilities: ReadonlySet<ReaderCapability>,
): ToolDef[] {
  return TOOL_REGISTRY.filter(
    (tool) => tool.group === group && tool.requires.every((c) => capabilities.has(c)),
  )
}
