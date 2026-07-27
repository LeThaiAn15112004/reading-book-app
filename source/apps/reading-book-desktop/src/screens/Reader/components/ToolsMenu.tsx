import type { AnnotateTool } from '../readerSession'
import { TOOL_LABELS } from '../readerSession'

type ToolsStripProps = {
  activeTool: AnnotateTool
  onSelectTool: (tool: Exclude<AnnotateTool, null>) => void
  onOpenSign: () => void
}

const MODE_TOOLS: Exclude<AnnotateTool, null>[] = [
  'note',
  'highlight',
  'comment',
  'typewriter',
  'esign',
]

const stripBtn =
  'inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-transparent px-2 text-lib-muted transition-colors hover:border-lib-accent-ring hover:bg-lib-accent-soft hover:text-lib-text-strong sm:h-10 sm:gap-2 sm:px-2.5'

function ToolIcon({ tool }: { tool: string }) {
  const cls = 'size-[18px] shrink-0'
  switch (tool) {
    case 'note':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
        </svg>
      )
    case 'highlight':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42" />
        </svg>
      )
    case 'comment':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
        </svg>
      )
    case 'typewriter':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5h10.5M6.75 12h10.5m-7.5 4.5h4.5M4.5 19.5h15A1.5 1.5 0 0 0 21 18V6a1.5 1.5 0 0 0-1.5-1.5h-15A1.5 1.5 0 0 0 3 6v12a1.5 1.5 0 0 0 1.5 1.5Z" />
        </svg>
      )
    case 'esign':
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

/** Horizontal annotate tools on the Reader chrome bar (1 tap to select). */
export function ToolsStrip({
  activeTool,
  onSelectTool,
  onOpenSign,
}: ToolsStripProps) {
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain sm:gap-1"
      role="toolbar"
      aria-label="Annotation tools"
      onClick={(e) => e.stopPropagation()}
    >
      {MODE_TOOLS.map((tool) => {
        const active = activeTool === tool
        return (
          <button
            key={tool}
            className={`${stripBtn}${active ? ' border-lib-accent bg-lib-accent-soft text-lib-accent' : ''}`}
            type="button"
            title={TOOL_LABELS[tool]}
            aria-label={TOOL_LABELS[tool]}
            aria-pressed={active}
            onClick={() => onSelectTool(tool)}
          >
            <ToolIcon tool={tool} />
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
