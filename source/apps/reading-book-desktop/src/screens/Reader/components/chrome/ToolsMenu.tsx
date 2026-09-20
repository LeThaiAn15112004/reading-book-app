import { ReaderSearchPanel } from './ReaderSearchPanel'

/** Toolbar mode buttons. */
export type ModeTool = 'hand' | 'select'

/** Companion actions — UI entry only until later phases. */
export type CompanionTool = 'search' | 'speech' | 'translate'

/** Annotation/markup tools — UI entry only until the rebuild lands. */
export type AnnotationTool = 'highlight' | 'underline' | 'strikethrough' | 'textarea' | 'freehand'

type ToolsStripProps = {
  /** Widened beyond `ModeTool` so the Highlight/Underline/Strikethrough buttons can show their
   *  own active state — only one of the toolbar tools is ever "on" at a time (see `ReaderScreen`). */
  activeTool: ModeTool | 'highlight' | 'underline' | 'strikethrough'
  onSelectTool: (tool: ModeTool) => void
  onOpenSign: () => void
  onCompanionTool: (tool: CompanionTool) => void
  onAnnotationTool: (tool: AnnotationTool) => void
  searchOpen: boolean
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  onSearchSubmit: () => void
  onCloseSearch: () => void
}

const NAV_TOOLS: ModeTool[] = ['hand', 'select']
const COMPANION_TOOLS: CompanionTool[] = ['search', 'speech', 'translate']
const ANNOTATION_TOOLS: AnnotationTool[] = [
  'highlight',
  'underline',
  'strikethrough',
  'textarea',
  'freehand',
]

const MODE_LABELS: Record<ModeTool, string> = {
  hand: 'Hand',
  select: 'Select',
}

const COMPANION_LABELS: Record<CompanionTool, string> = {
  search: 'Search',
  speech: 'Speech',
  translate: 'Translate',
}

const ANNOTATION_LABELS: Record<AnnotationTool, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikethrough: 'Strikethrough',
  textarea: 'Textbox',
  freehand: 'Freehand',
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
  children: React.ReactNode
  'aria-label'?: string
}) {
  return (
    <div className={toolGroupClass} role="group" aria-label={ariaLabel}>
      {children}
    </div>
  )
}

function ToolIcon({ tool }: { tool: string }) {
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
    case 'textarea':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11ZM7.5 9.5h9M7.5 13h6"
          />
        </svg>
      )
    case 'freehand':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 17.5c1.5-4.5 2.5-9 4.5-9s1.5 6 3.5 6 1.5-8 4-8 2 7.5 4 7.5M4 20.5h16"
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

function modeButtonClass(active: boolean): string {
  if (active) {
    return `${stripBtn} border-lib-accent bg-lib-accent-soft text-lib-accent`
  }
  return stripBtn
}

/** Compact tools strip: icon above, label below — grouped sections. */
export function ToolsStrip({
  activeTool,
  onSelectTool,
  onOpenSign,
  onCompanionTool,
  onAnnotationTool,
  searchOpen,
  searchQuery,
  onSearchQueryChange,
  onSearchSubmit,
  onCloseSearch,
}: ToolsStripProps) {
  function renderModeButton(tool: ModeTool) {
    const active = activeTool === tool
    const label = MODE_LABELS[tool]

    return (
      <button
        key={tool}
        className={`relative ${modeButtonClass(active)}`}
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={active}
        onClick={() => onSelectTool(tool)}
      >
        <ToolIcon tool={tool} />
        <span className={stripLabel}>{label}</span>
      </button>
    )
  }

  return (
    <div
      className="relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain sm:gap-1.5"
      role="toolbar"
      aria-label="Reading tools"
      onClick={(e) => e.stopPropagation()}
    >
      <ToolGroup aria-label="Navigation and lookup">
        {NAV_TOOLS.map((tool) => renderModeButton(tool))}
        {COMPANION_TOOLS.map((tool) =>
          tool === 'search' ? (
            <div key={tool} className="relative shrink-0">
              <button
                className={modeButtonClass(searchOpen)}
                type="button"
                title={COMPANION_LABELS[tool]}
                aria-label={COMPANION_LABELS[tool]}
                aria-pressed={searchOpen}
                onClick={() => onCompanionTool(tool)}
              >
                <ToolIcon tool={tool} />
                <span className={stripLabel}>{COMPANION_LABELS[tool]}</span>
              </button>
              <ReaderSearchPanel
                open={searchOpen}
                query={searchQuery}
                onQueryChange={onSearchQueryChange}
                onSubmit={onSearchSubmit}
                onClose={onCloseSearch}
              />
            </div>
          ) : (
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
          ),
        )}
      </ToolGroup>

      <ToolSeparator />

      <ToolGroup aria-label="Annotation tools">
        {ANNOTATION_TOOLS.map((tool) => {
          const active = activeTool === tool
          return (
            <button
              key={tool}
              className={`relative ${modeButtonClass(active)}`}
              type="button"
              title={ANNOTATION_LABELS[tool]}
              aria-label={ANNOTATION_LABELS[tool]}
              aria-pressed={active}
              onClick={() => onAnnotationTool(tool)}
            >
              <ToolIcon tool={tool} />
              <span className={stripLabel}>{ANNOTATION_LABELS[tool]}</span>
            </button>
          )
        })}
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
  )
}
