import type { ReaderCapability } from '../../../../reader/capabilities'
import {
  FOLD_ORDER,
  INLINE_MAX,
  TOOL_GROUPS,
  toolsForGroup,
  type ToolDef,
  type ToolGroupDef,
  type ToolGroupId,
} from './toolRegistry'

export type ResolvedToolGroup = {
  group: ToolGroupDef
  tools: ToolDef[]
  /** `inline`: one button per tool. `menu`: a single dropdown trigger. */
  mode: 'inline' | 'menu'
}

/** `auto` groups that are inline at fold level 0, in the order they fold. */
export function foldableGroups(capabilities: ReadonlySet<ReaderCapability>): ToolGroupId[] {
  return FOLD_ORDER.filter((id) => {
    const group = TOOL_GROUPS.find((g) => g.id === id)
    const count = toolsForGroup(id, capabilities).length
    return group?.collapse === 'auto' && count > 0 && count <= INLINE_MAX
  })
}

/**
 * The toolbar for a reader surface at a given fold level (0 = nothing folded; each level folds the
 * next group of `foldableGroups`). Pure — the strip and the spike share it.
 */
export function resolveToolbarLayout(
  capabilities: ReadonlySet<ReaderCapability>,
  foldLevel: number,
): ResolvedToolGroup[] {
  const folded = new Set(foldableGroups(capabilities).slice(0, Math.max(0, foldLevel)))
  return TOOL_GROUPS.flatMap((group) => {
    const tools = toolsForGroup(group.id, capabilities)
    if (tools.length === 0) return []
    const mode: ResolvedToolGroup['mode'] =
      group.collapse === 'never'
        ? 'inline'
        : tools.length > INLINE_MAX || folded.has(group.id)
          ? 'menu'
          : 'inline'
    return [{ group, tools, mode }]
  })
}
