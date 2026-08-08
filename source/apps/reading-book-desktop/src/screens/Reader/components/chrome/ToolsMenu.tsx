import { useCallback, useRef, useState, type ReactNode } from 'react'
import {
  TOOL_LABELS,
  type AnnotateTool,
  type DrawToolSettings,
  type DrawingTool,
} from '@reading-book/shared/models'
import { DrawingToolOptionsPopover } from './DrawingToolOptionsPopover'

/** Toolbar mode buttons (distinct from surface InteractionTool which includes `annotate`). */
export type ModeTool =
  | 'hand'
  | 'select'
  | 'highlight'
  | 'typewriter'
  | 'pencil'
  | 'shape'
  | 'eraser'

/** Companion actions — UI entry only until later phases. */
export type CompanionTool = 'search' | 'speech' | 'translate'

type DrawOptionsTool = Extract<DrawingTool, 'pencil' | 'shape'>

type ToolsStripProps = {
  activeTool: AnnotateTool
  drawSettings: DrawToolSettings
  onDrawSettingsChange: (patch: Partial<DrawToolSettings>) => void
  onSelectTool: (tool: ModeTool) => void
  onOpenSign: () => void
  onCompanionTool: (tool: CompanionTool) => void
}

const NAV_TOOLS: Extract<ModeTool, 'hand' | 'select'>[] = ['hand', 'select']
const COMPANION_TOOLS: CompanionTool[] = ['search', 'speech', 'translate']
const ANNOTATION_TOOLS: ModeTool[] = [
  'highlight',
  'pencil',
  'shape',
  'eraser',
  'typewriter',
]

const COMPANION_LABELS: Record<CompanionTool, string> = {
  search: 'Search',
  speech: 'Speech',
  translate: 'Translate',
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

/** Text-cursor + "T" badge while Highlight tool is active. */
function HighlightActiveIcon() {
  return (
    <span
      className="relative inline-flex size-[18px] shrink-0 items-end justify-center"
      aria-hidden
    >
      <svg
        className="size-[18px]"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.8}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42"
        />
      </svg>
    </span>
  )
}

function ToolIcon({ tool, active }: { tool: string; active?: boolean }) {
  const cls = 'size-[18px] shrink-0'
  if (tool === 'highlight' && active) {
    return <HighlightActiveIcon />
  }
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
    case 'highlight':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42"
          />
        </svg>
      )
    case 'pencil':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
          />
        </svg>
      )
    case 'shape':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75h6.75M4.5 19.5h15M19.5 4.5v15" />
          <rect x="13.5" y="4.5" width="6" height="6" rx="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'eraser':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m14.74 9.346-4.243 4.243a2.25 2.25 0 0 0 0 3.182l1.768 1.768a2.25 2.25 0 0 0 3.182 0l4.243-4.243M6.75 19.5h12"
          />
        </svg>
      )
    case 'typewriter':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.5 7.5h15M6 7.5V6.75A1.75 1.75 0 0 1 7.75 5h8.5A1.75 1.75 0 0 1 18 6.75V7.5m-12 0v9.75A1.75 1.75 0 0 0 7.75 19h8.5A1.75 1.75 0 0 0 18 17.25V7.5M8.25 10.5h7.5M8.25 13.5h7.5M8.25 16.5h4.5"
          />
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
            d="M12 4.5a3 3 0 0 0-3 3v4.5a3 3 0 1 0 6 0V7.5a3 3 0 0 0-3-3Zm-6.75 7.5a6.75 6.75 0 0 0 13.5 0M12 18.75v1.75m-3 0h6"
          />
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
    case 'sign':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487 19.5 7.125M7.5 16.5l2.25.75L16.5 10.5a1.5 1.5 0 0 0-2.121-2.121L7.629 15.129 7.5 16.5Zm-3.75 3h15" />
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

function modeLabel(tool: ModeTool): string {
  if (tool === 'select') return 'Select'
  return TOOL_LABELS[tool]
}

function modeButtonClass(tool: ModeTool, active: boolean): string {
  const highlightActive = tool === 'highlight' && active
  if (highlightActive) {
    return `${stripBtn} border-lib-accent bg-lib-accent text-lib-on-accent hover:bg-lib-accent-hover hover:text-lib-on-accent`
  }
  if (active) {
    return `${stripBtn} border-lib-accent bg-lib-accent-soft text-lib-accent`
  }
  return stripBtn
}

/** Compact tools strip: icon above, label below — three grouped sections. */
export function ToolsStrip({
  activeTool,
  drawSettings,
  onDrawSettingsChange,
  onSelectTool,
  onOpenSign,
  onCompanionTool,
}: ToolsStripProps) {
  const [drawOptionsTool, setDrawOptionsTool] = useState<DrawOptionsTool | null>(
    null,
  )
  const drawOptionsAnchorRef = useRef<HTMLElement | null>(null)

  const closeDrawOptions = useCallback(() => {
    setDrawOptionsTool(null)
    drawOptionsAnchorRef.current = null
  }, [])

  function openDrawOptions(tool: DrawOptionsTool, anchor: HTMLElement) {
    drawOptionsAnchorRef.current = anchor
    setDrawOptionsTool(tool)
  }

  function renderModeButton(tool: ModeTool) {
    const active = activeTool === tool
    const hasDrawOptions = tool === 'pencil' || tool === 'shape'
    const label = modeLabel(tool)

    return (
      <button
        key={tool}
        className={`relative ${modeButtonClass(tool, active)}`}
        type="button"
        title={
          hasDrawOptions
            ? `${label} — double-click for stroke & color`
            : TOOL_LABELS[tool]
        }
        aria-label={label}
        aria-pressed={active}
        onClick={() => onSelectTool(tool)}
        onDoubleClick={
          hasDrawOptions
            ? (event) => {
                event.preventDefault()
                event.stopPropagation()
                onSelectTool(tool)
                openDrawOptions(tool, event.currentTarget)
              }
            : undefined
        }
      >
        <ToolIcon tool={tool} active={active} />
        <span className={stripLabel}>{label}</span>
        {hasDrawOptions && active ? (
          <span
            className="absolute bottom-1.5 right-1.5 size-2 rounded-full border border-lib-surface-strong"
            style={{ backgroundColor: drawSettings.colorHex }}
            aria-hidden
          />
        ) : null}
      </button>
    )
  }

  return (
    <>
      <div
        className="relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain sm:gap-1.5"
        role="toolbar"
        aria-label="Reading tools"
        onClick={(e) => e.stopPropagation()}
      >
        <ToolGroup aria-label="Navigation and lookup">
          {NAV_TOOLS.map((tool) => renderModeButton(tool))}
          {COMPANION_TOOLS.map((tool) => (
            <button
              key={tool}
              className={stripBtn}
              type="button"
              title={COMPANION_LABELS[tool]}
              aria-label={COMPANION_LABELS[tool]}
              onClick={() => onCompanionTool(tool)}
            >
              <ToolIcon tool={tool} />
              <span className={stripLabel}>{COMPANION_LABELS[tool]}</span>
            </button>
          ))}
        </ToolGroup>

        <ToolSeparator />

        <ToolGroup aria-label="Annotation tools">
          {ANNOTATION_TOOLS.map((tool) => renderModeButton(tool))}
        </ToolGroup>

        <ToolSeparator />

        <ToolGroup aria-label="Other tools">
          <button
            className={stripBtn}
            type="button"
            title="Sign"
            aria-label="Sign"
            onClick={onOpenSign}
          >
            <ToolIcon tool="sign" />
            <span className={stripLabel}>Sign</span>
          </button>
        </ToolGroup>
      </div>

      {drawOptionsTool ? (
        <DrawingToolOptionsPopover
          tool={drawOptionsTool}
          anchorEl={drawOptionsAnchorRef.current}
          settings={drawSettings}
          onChange={onDrawSettingsChange}
          onClose={closeDrawOptions}
        />
      ) : null}
    </>
  )
}
