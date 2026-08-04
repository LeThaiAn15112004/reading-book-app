import type { AnnotateTool, InteractionTool } from '../../readerSession'
import { TOOL_LABELS } from '../../readerSession'

type ToolsStripProps = {
  activeTool: AnnotateTool
  onSelectTool: (tool: InteractionTool) => void
  onOpenSign: () => void
}

const MODE_TOOLS: InteractionTool[] = ['hand', 'select', 'highlight']

const stripBtn =
  'inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-transparent px-2 text-lib-muted transition-colors hover:border-lib-accent-ring hover:bg-lib-accent-soft hover:text-lib-text-strong sm:h-10 sm:gap-2 sm:px-2.5'

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
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 4h8M12 4v16M9.5 20h5"
          />
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

/** Horizontal interaction tools: Hand, Text Select, Highlight. */
export function ToolsStrip({
  activeTool,
  onSelectTool,
  onOpenSign,
}: ToolsStripProps) {
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain sm:gap-1"
      role="toolbar"
      aria-label="Reading tools"
      onClick={(e) => e.stopPropagation()}
    >
      {MODE_TOOLS.map((tool) => {
        const active = activeTool === tool
        const highlightActive = tool === 'highlight' && active
        return (
          <button
            key={tool}
            className={`${stripBtn}${
              highlightActive
                ? ' border-lib-accent bg-lib-accent text-lib-on-accent hover:bg-lib-accent-hover hover:text-lib-on-accent'
                : active
                  ? ' border-lib-accent bg-lib-accent-soft text-lib-accent'
                  : ''
            }`}
            type="button"
            title={TOOL_LABELS[tool]}
            aria-label={TOOL_LABELS[tool]}
            aria-pressed={active}
            onClick={() => onSelectTool(tool)}
          >
            <ToolIcon tool={tool} active={active} />
            <span className="hidden text-[12px] font-semibold whitespace-nowrap lg:inline">
              {TOOL_LABELS[tool]}
            </span>
          </button>
        )
      })}
      <span className="mx-0.5 hidden h-5 w-px shrink-0 bg-lib-border sm:mx-1 sm:block" aria-hidden />
      <button
        className={stripBtn}
        type="button"
        title="Sign"
        aria-label="Sign"
        onClick={onOpenSign}
      >
        <ToolIcon tool="sign" />
        <span className="hidden text-[12px] font-semibold whitespace-nowrap lg:inline">
          Sign
        </span>
      </button>
    </div>
  )
}
