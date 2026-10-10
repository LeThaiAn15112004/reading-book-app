import { useRef, type ReactNode, type Ref } from 'react'
import type { ReaderCapability } from '../../../../reader/capabilities'
import { effectiveShortcutKeys, useShortcutsStore } from '../../../../shortcuts/shortcutsStore'
import { formatShortcutKey } from '../../../../shortcuts/shortcutKeys'
import { ToolGroupMenu } from './ToolGroupMenu'
import { resolveToolbarLayout, foldableGroups, type ResolvedToolGroup } from './toolbarLayout'
import type {
  AnnotationTool,
  CompanionTool,
  ModeTool,
  ToolDef,
  ToolIconId,
  ToolId,
} from './toolRegistry'
import { useToolbarOverflow } from './useToolbarOverflow'

export type { AnnotationTool, CompanionTool, ModeTool, ToolId }

/** Per-tool UI state supplied by the screen; tools without an entry are plain, inactive buttons. */
export type ToolState = {
  /** Armed / on — accent style, `aria-pressed`. */
  active?: boolean
  /** Its menu / panel is open (`aria-expanded`, for tools with `popup`). */
  expanded?: boolean
}

export type ToolStates = Partial<Record<ToolId, ToolState>>

type ToolsStripProps = {
  /** What the open book's reader surface supports — other tools are not rendered. */
  capabilities: ReadonlySet<ReaderCapability>
  toolStates: ToolStates
  onTool: (tool: ToolId) => void
  /** Buttons something else anchors to (the read-aloud menu floats under Audio). */
  toolRefs?: Partial<Record<ToolId, Ref<HTMLButtonElement>>>
  /** Toolbar is hidden — open dropdowns close. */
  hidden?: boolean
}

const stripBtn =
  'inline-flex h-[52px] w-[52px] shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-transparent px-0.5 text-lib-muted transition-colors hover:border-lib-accent-ring hover:bg-lib-accent-soft hover:text-lib-text-strong sm:h-[56px] sm:w-[58px]'

const stripLabel =
  'max-w-full text-center text-[10px] leading-tight font-semibold whitespace-normal sm:text-[11px]'

const toolGroupClass =
  'flex shrink-0 items-center gap-0.5 rounded-lg bg-lib-hint/40 px-0.5 py-0.5 sm:gap-1 sm:px-1'

function ToolSeparator() {
  return (
    <span
      className="mx-0.5 hidden h-9 w-px shrink-0 self-center bg-lib-border sm:mx-1 sm:block"
      aria-hidden
    />
  )
}

function ToolGroup({
  children,
  'aria-label': ariaLabel,
}: {
  children: ReactNode
  'aria-label'?: string
}) {
  return (
    <div className={toolGroupClass} role="group" aria-label={ariaLabel}>
      {children}
    </div>
  )
}

function ToolIcon({ tool }: { tool: ToolIconId }) {
  const cls = 'size-[18px] shrink-0'
  switch (tool) {
    case 'hand':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.5 11.5V7.25a1.25 1.25 0 0 1 2.5 0V11.5m0-3.25a1.25 1.25 0 0 1 2.5 0V11.5m0-2a1.25 1.25 0 0 1 2.5 0v3.25m0-1a1.25 1.25 0 0 1 2.5 0v4.5a5.25 5.25 0 0 1-5.25 5.25h-.5A5.75 5.75 0 0 1 6 15.5v-2.25a1.75 1.75 0 0 1 1.5-1.75Z"
          />
        </svg>
      )
    case 'select':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 4h8M12 4v16M9.5 20h5" />
        </svg>
      )
    case 'search':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
        </svg>
      )
    case 'speech':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 9.75h3.4l4.2-3.6a.6.6 0 0 1 1 .46v10.78a.6.6 0 0 1-1 .46l-4.2-3.6H4a.75.75 0 0 1-.75-.75v-3a.75.75 0 0 1 .75-.75Z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 9c1 .9 1 5.1 0 6M18.3 6.7c2.2 2.2 2.2 8.4 0 10.6" />
        </svg>
      )
    case 'translate':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.5-2.7 3.75-5.7 3.75-9S14.5 5.7 12 3m0 18c-2.5-2.7-3.75-5.7-3.75-9S9.5 5.7 12 3M3.75 9.75h16.5M3.75 14.25h16.5"
          />
        </svg>
      )
    case 'highlight':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m9 11 6-6 4 4-6 6m-4-4-4.5 4.5a1.5 1.5 0 0 0-.396.683L3 20l3.817-1.104a1.5 1.5 0 0 0 .683-.396L12 14m-3-3 4 4M4 21h16"
          />
        </svg>
      )
    case 'underline':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 4v6.5a6 6 0 0 0 12 0V4M4 20h16"
          />
        </svg>
      )
    case 'strikethrough':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.6 8.25c-.35-1.45-1.9-2.5-3.6-2.5-2 0-3.6 1.12-3.6 2.75 0 1.1.7 1.85 1.9 2.25M8.4 15.75c.35 1.45 1.9 2.5 3.6 2.5 2 0 3.6-1.12 3.6-2.75 0-.45-.12-.85-.35-1.2M4 12h16"
          />
        </svg>
      )
    case 'snapshot':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 8.25A1.75 1.75 0 0 1 5.75 6.5h1.19c.32 0 .62-.16.8-.43l.7-1.05c.32-.48.87-.77 1.45-.77h4.22c.58 0 1.13.29 1.45.77l.7 1.05c.18.27.48.43.8.43h1.19A1.75 1.75 0 0 1 20 8.25v8.5A1.75 1.75 0 0 1 18.25 18.5H5.75A1.75 1.75 0 0 1 4 16.75v-8.5Z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12.25a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
      )
    case 'wordCount':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 4v16M18 4v16M6 8h4M6 12h6M6 16h4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 16.5V13a1.5 1.5 0 0 1 3 0v3.5M14 15h3" />
        </svg>
      )
    case 'settings':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
      )
    case 'view':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z" />
        </svg>
      )
    case 'tools':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3.5 17.2a1.6 1.6 0 0 0 2.3 2.3l5.8-5.8a4 4 0 0 0 5.1-5.4l-2.4 2.4-2-.5-.5-2 2.4-2.4Z" />
        </svg>
      )
    default:
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      )
  }
}

function modeButtonClass(active: boolean): string {
  if (active) {
    return `${stripBtn} border-lib-accent bg-lib-accent-soft text-lib-accent`
  }
  return stripBtn
}

/** Dropdown trigger: same look as a strip button but sized to its label + chevron. */
const menuTriggerBtn =
  'inline-flex h-[52px] min-w-[52px] shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-transparent px-2 text-lib-muted transition-colors hover:border-lib-accent-ring hover:bg-lib-accent-soft hover:text-lib-text-strong sm:h-[56px] sm:min-w-[58px]'

function menuTriggerClass(active: boolean): string {
  return active ? `${menuTriggerBtn} border-lib-accent bg-lib-accent-soft text-lib-accent` : menuTriggerBtn
}

/** Tooltip: description (or label) plus the tool's current shortcut, e.g. `Search in book (Ctrl+F)`. */
function useToolTitle(): (tool: ToolDef) => string {
  const overrides = useShortcutsStore((s) => s.overrides)
  const keys = effectiveShortcutKeys(overrides)
  return (tool) => {
    const text = tool.description ?? tool.label
    if (!tool.shortcutId) return text
    const shortcut = keys[tool.shortcutId].map((key) => formatShortcutKey(key)).join('+')
    return shortcut ? `${text} (${shortcut})` : text
  }
}

/**
 * Reader tools strip: icon above, label below, grouped sections. Built from `TOOL_REGISTRY` for the
 * open surface's capabilities; `auto` groups fold into dropdowns when the strip runs out of room.
 * See docs/implementation_plan/reader_toolbar.md.
 */
export function ToolsStrip({ capabilities, toolStates, onTool, toolRefs, hidden = false }: ToolsStripProps) {
  const stripRef = useRef<HTMLDivElement | null>(null)
  const foldLevel = useToolbarOverflow(stripRef, foldableGroups(capabilities).length)
  const layout = resolveToolbarLayout(capabilities, foldLevel)
  const toolTitle = useToolTitle()

  function renderButton(tool: ToolDef) {
    const state = toolStates[tool.id]
    const active = state?.active ?? false
    return (
      <button
        key={tool.id}
        ref={toolRefs?.[tool.id]}
        className={`relative ${modeButtonClass(active)}`}
        type="button"
        title={toolTitle(tool)}
        aria-label={tool.label}
        aria-pressed={tool.popup ? undefined : active}
        aria-haspopup={tool.popup}
        aria-expanded={tool.popup ? (state?.expanded ?? false) : undefined}
        onClick={() => onTool(tool.id)}
      >
        <ToolIcon tool={tool.id} />
        <span className={stripLabel}>{tool.label}</span>
      </button>
    )
  }

  function renderMenu({ group, tools }: ResolvedToolGroup) {
    const armed = tools.find((tool) => toolStates[tool.id]?.active)
    return (
      <ToolGroupMenu
        label={armed ? armed.label : group.label}
        icon={<ToolIcon tool={armed ? armed.id : group.icon} />}
        title={armed ? `${group.label}: ${armed.label}` : group.label}
        active={armed !== undefined}
        hidden={hidden}
        buttonClassName={menuTriggerClass(armed !== undefined)}
        labelClassName={stripLabel}
        items={tools.map((tool) => ({
          id: tool.id,
          label: tool.label,
          icon: <ToolIcon tool={tool.id} />,
          active: toolStates[tool.id]?.active,
          shortcutId: tool.shortcutId,
          onSelect: () => onTool(tool.id),
        }))}
      />
    )
  }

  return (
    <div
      ref={stripRef}
      className="relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain sm:gap-1.5"
      role="toolbar"
      aria-label="Reading tools"
      onClick={(e) => e.stopPropagation()}
    >
      {layout.map((resolved, index) => (
        <div key={resolved.group.id} className="contents">
          {index > 0 ? <ToolSeparator /> : null}
          <ToolGroup aria-label={resolved.group.label}>
            {resolved.mode === 'menu' ? renderMenu(resolved) : resolved.tools.map(renderButton)}
          </ToolGroup>
        </div>
      ))}
    </div>
  )
}
