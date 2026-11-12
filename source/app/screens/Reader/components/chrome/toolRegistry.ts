import type { MessageKey } from '@core'
import type { ReaderCapability } from '../../../../components/reader/capabilities'
import type { ShortcutId } from '../../../../shortcuts/shortcutDefinitions'

/**
 * Single source of truth for the Reader toolbar: which tools exist, which group each belongs to, what
 * the reader surface must support for it to show, and how groups fold on a narrow window.
 * See docs/implementation_plan/reader_toolbar.md.
 */

/** Toolbar mode buttons. */
export type ModeTool = 'hand' | 'select' | 'edit'

/** Companion actions next to the modes. */
export type CompanionTool = 'search' | 'speech' | 'translate'

/** Markup tools — armed one at a time, sticky until toggled off / Escape / Hand / Select. */
export type AnnotationTool = 'highlight' | 'underline' | 'squiggly' | 'strikethrough' | 'replace' | 'insert' | 'pen'

/** Freehand Ink tools next to the markup tools (both are armed like a markup tool; the eraser removes whole Ink strokes only). */
export type FreehandTool = 'pen' | 'shape' | 'eraser' | 'typewriter' | 'fileAttachment'

/** How the Eraser removes ink: whole strokes, or only the part under the eraser. */
export type EraserMode = 'stroke' | 'partial'

/** Utility tools. */
export type MiscTool = 'snapshot' | 'wordCount'

export type ToolId = ModeTool | CompanionTool | AnnotationTool | FreehandTool | MiscTool | 'settings'

export type ToolGroupId = 'navigate' | 'annotation' | 'freehand' | 'view' | 'tools' | 'settings'

/** Icon names understood by `ToolIcon` — every tool id plus the group triggers. */
export type ToolIconId = ToolId | 'view' | 'tools'

export type ToolDef = {
  id: ToolId
  labelKey: MessageKey
  group: ToolGroupId
  /** Tooltip text when the label alone isn't self-explanatory. */
  descriptionKey?: MessageKey
  /** Shown only when the reader surface has all of these (see `reader/capabilities.ts`). */
  requires: readonly ReaderCapability[]
  /** Its key is shown in the tooltip and in dropdowns, following the user's customization. */
  shortcutId?: ShortcutId
  /** The button opens a menu / panel (sets `aria-haspopup` + `aria-expanded`). */
  popup?: 'menu' | 'dialog'
}

export type ToolGroupDef = {
  id: ToolGroupId
  labelKey: MessageKey
  icon: ToolIconId
  /** `never`: always inline (frequent tools). `always`: always one dropdown. `auto`: inline until
   *  the strip runs out of room. */
  collapse: 'never' | 'always' | 'auto'
  /** Inline buttons are compact icons without a label (the tooltip names the tool). */
  iconOnly?: boolean
}

/** Toolbar order. Empty groups (nothing supported by the surface) are not rendered. */
export const TOOL_GROUPS: readonly ToolGroupDef[] = [
  { id: 'navigate', labelKey: 'reader.chrome.groups.navigate', icon: 'hand', collapse: 'never' },
  { id: 'annotation', labelKey: 'reader.chrome.groups.annotation', icon: 'highlight', collapse: 'never', iconOnly: true },
  { id: 'freehand', labelKey: 'reader.chrome.groups.freehand', icon: 'pen', collapse: 'never' },
  { id: 'tools', labelKey: 'reader.chrome.groups.tools', icon: 'tools', collapse: 'never' },
  { id: 'view', labelKey: 'reader.chrome.groups.view', icon: 'view', collapse: 'auto' },
  { id: 'settings', labelKey: 'reader.chrome.groups.settings', icon: 'settings', collapse: 'never' },
]

/** A group with more tools than this is always a dropdown. */
export const INLINE_MAX = 4

/** Order `auto` groups fold into dropdowns when the strip overflows — least used first. */
export const FOLD_ORDER: readonly ToolGroupId[] = ['view', 'annotation']

/** Order within a group is toolbar / menu order. */
export const TOOL_REGISTRY: readonly ToolDef[] = [
  { id: 'hand', labelKey: 'reader.chrome.tools.hand', group: 'navigate', descriptionKey: 'reader.chrome.toolDescriptions.hand', requires: ['interaction', 'pan'] },
  { id: 'edit', labelKey: 'reader.chrome.tools.edit', group: 'navigate', descriptionKey: 'reader.chrome.toolDescriptions.edit', requires: ['textEdit'] },
  { id: 'select', labelKey: 'reader.chrome.tools.select', group: 'navigate', descriptionKey: 'reader.chrome.toolDescriptions.select', requires: ['interaction'] },
  { id: 'search', labelKey: 'reader.chrome.tools.search', group: 'navigate', descriptionKey: 'reader.chrome.toolDescriptions.search', requires: ['search'], shortcutId: 'general.searchBook' },
  { id: 'speech', labelKey: 'reader.chrome.tools.speech', group: 'navigate', descriptionKey: 'reader.chrome.toolDescriptions.speech', requires: ['readAloud'], popup: 'menu' },
  { id: 'translate', labelKey: 'reader.chrome.tools.translate', group: 'navigate', descriptionKey: 'reader.chrome.toolDescriptions.translate', requires: ['translate'] },
  { id: 'highlight', labelKey: 'reader.chrome.tools.highlight', group: 'annotation', descriptionKey: 'reader.chrome.toolDescriptions.highlight', requires: ['markupAnnotations'] },
  { id: 'underline', labelKey: 'reader.chrome.tools.underline', group: 'annotation', descriptionKey: 'reader.chrome.toolDescriptions.underline', requires: ['markupAnnotations'] },
  { id: 'squiggly', labelKey: 'reader.chrome.tools.squiggly', group: 'annotation', descriptionKey: 'reader.chrome.toolDescriptions.squiggly', requires: ['markupAnnotations'] },
  { id: 'strikethrough', labelKey: 'reader.chrome.tools.strikethrough', group: 'annotation', descriptionKey: 'reader.chrome.toolDescriptions.strikethrough', requires: ['markupAnnotations'] },
  { id: 'replace', labelKey: 'reader.chrome.tools.replace', group: 'annotation', descriptionKey: 'reader.chrome.toolDescriptions.replace', requires: ['markupAnnotations'] },
  { id: 'insert', labelKey: 'reader.chrome.tools.insert', group: 'annotation', descriptionKey: 'reader.chrome.toolDescriptions.insert', requires: ['markupAnnotations'] },
  { id: 'pen', labelKey: 'reader.chrome.tools.pen', group: 'freehand', descriptionKey: 'reader.chrome.toolDescriptions.pen', requires: ['inkAnnotations'] },
  { id: 'shape', labelKey: 'reader.chrome.tools.shape', group: 'freehand', descriptionKey: 'reader.chrome.toolDescriptions.shape', requires: ['shapeAnnotations'] },
  { id: 'eraser', labelKey: 'reader.chrome.tools.eraser', group: 'freehand', descriptionKey: 'reader.chrome.toolDescriptions.eraser', requires: ['inkAnnotations'] },
  { id: 'typewriter', labelKey: 'reader.chrome.tools.typewriter', group: 'freehand', descriptionKey: 'reader.chrome.toolDescriptions.typewriter', requires: ['typewriterAnnotations'] },
  { id: 'fileAttachment', labelKey: 'reader.chrome.tools.fileAttachment', group: 'freehand', descriptionKey: 'reader.chrome.toolDescriptions.fileAttachment', requires: ['fileAttachments'] },
  { id: 'snapshot', labelKey: 'reader.chrome.tools.snapshot', group: 'tools', descriptionKey: 'reader.chrome.toolDescriptions.snapshot', requires: ['snapshot'] },
  { id: 'wordCount', labelKey: 'reader.chrome.tools.wordCount', group: 'tools', descriptionKey: 'reader.chrome.toolDescriptions.wordCount', requires: ['wordCount'] },
  { id: 'settings', labelKey: 'reader.chrome.tools.settings', group: 'settings', descriptionKey: 'reader.chrome.toolDescriptions.settings', requires: ['readingSettings'], popup: 'dialog' },
]

export function toolsForGroup(
  group: ToolGroupId,
  capabilities: ReadonlySet<ReaderCapability>,
): ToolDef[] {
  return TOOL_REGISTRY.filter(
    (tool) => tool.group === group && tool.requires.every((c) => capabilities.has(c)),
  )
}
