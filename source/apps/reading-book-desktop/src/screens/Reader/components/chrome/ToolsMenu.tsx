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
  onCompanionTool: (tool: CompanionTool) => void
  onAnnotationTool: (tool: AnnotationTool) => void
  /** Search tool's pressed state — the results panel itself floats independently (see
   *  `ReaderSearchPanel`, rendered by `ReaderScreen`), Foxit/Thorium-style, not anchored here. */
  searchOpen: boolean
  /** Translate mode armed — a finished selection opens the translation popover. It rides on
   *  Select (text must be selectable), so Select itself isn't shown pressed meanwhile. */
  translateActive: boolean
  /** Audio (read aloud) menu open or reading in progress — the menu floats via `ReadAloudMenu`. */
  audioActive: boolean
  audioMenuOpen: boolean
  audioButtonRef: React.Ref<HTMLButtonElement>
  /** Snapshot tool's armed state — the crosshair overlay itself floats independently (see
   *  `SnapshotOverlay`, rendered by `ReaderScreen`), same story as Search. */
  snapshotActive: boolean
  onSnapshot: () => void
  onWordCount: () => void
  /** Reading settings (Aa) panel open — the panel itself floats independently (see `AaSettingsPanel`). */
  settingsOpen: boolean
  onToggleSettings: () => void
  /** Annotation tools to omit from the strip entirely — e.g. EPUB has no Freehand/Textbox. */
  hiddenAnnotationTools?: AnnotationTool[]
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
  speech: 'Audio',
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
  onCompanionTool,
  onAnnotationTool,
  searchOpen,
  translateActive,
  audioActive,
  audioMenuOpen,
  audioButtonRef,
  snapshotActive,
  onSnapshot,
  onWordCount,
  settingsOpen,
  onToggleSettings,
  hiddenAnnotationTools,
}: ToolsStripProps) {
  const annotationTools = hiddenAnnotationTools?.length
    ? ANNOTATION_TOOLS.filter((tool) => !hiddenAnnotationTools.includes(tool))
    : ANNOTATION_TOOLS
  function renderModeButton(tool: ModeTool) {
    const active = activeTool === tool && !(tool === 'select' && translateActive)
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
        {COMPANION_TOOLS.map((tool) => (
          <button
            key={tool}
            ref={tool === 'speech' ? audioButtonRef : undefined}
            className={
              tool === 'search'
                ? modeButtonClass(searchOpen)
                : tool === 'speech'
                  ? modeButtonClass(audioActive)
                  : modeButtonClass(translateActive)
            }
            type="button"
            title={COMPANION_LABELS[tool]}
            aria-label={COMPANION_LABELS[tool]}
            aria-pressed={
              tool === 'search' ? searchOpen : tool === 'translate' ? translateActive : undefined
            }
            aria-haspopup={tool === 'speech' ? 'menu' : undefined}
            aria-expanded={tool === 'speech' ? audioMenuOpen : undefined}
            onClick={() => onCompanionTool(tool)}
          >
            <ToolIcon tool={tool} />
            <span className={stripLabel}>{COMPANION_LABELS[tool]}</span>
          </button>
        ))}
      </ToolGroup>

      <ToolSeparator />

      <ToolGroup aria-label="Annotation tools">
        {annotationTools.map((tool) => {
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
          className={modeButtonClass(snapshotActive)}
          type="button"
          title="Snapshot"
          aria-label="Snapshot"
          aria-pressed={snapshotActive}
          onClick={onSnapshot}
        >
          <ToolIcon tool="snapshot" />
          <span className={stripLabel}>Snapshot</span>
        </button>
        <button
          className={stripBtn}
          type="button"
          title="Word Count"
          aria-label="Word Count"
          onClick={onWordCount}
        >
          <ToolIcon tool="wordCount" />
          <span className={stripLabel}>Word Count</span>
        </button>
      </ToolGroup>

      <ToolSeparator />

      <ToolGroup aria-label="Reading settings">
        <button
          className={modeButtonClass(settingsOpen)}
          type="button"
          title="Reading settings"
          aria-label="Reading settings"
          aria-expanded={settingsOpen}
          onClick={onToggleSettings}
        >
          <ToolIcon tool="settings" />
          <span className={stripLabel}>Settings</span>
        </button>
      </ToolGroup>
    </div>
  )
}
