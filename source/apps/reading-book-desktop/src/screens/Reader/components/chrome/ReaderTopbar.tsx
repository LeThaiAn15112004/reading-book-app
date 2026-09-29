import { MoreMenu } from './MoreMenu'
import {
  ToolsStrip,
  type AnnotationTool,
  type CompanionTool,
  type ModeTool,
} from './ToolsMenu'

type ReaderTopbarProps = {
  chromeHidden: boolean
  moreOpen: boolean
  settingsOpen: boolean
  activeTool: ModeTool | 'highlight' | 'underline' | 'strikethrough'
  onToggleMore: () => void
  onToggleSettings: () => void
  onSelectTool: (tool: ModeTool) => void
  onCompanionTool: (tool: CompanionTool) => void
  onAnnotationTool: (tool: AnnotationTool) => void
  onShare: () => void
  onFavorites: () => void
  onBookInfo: () => void
  onTrash: () => void
  /** Search tool's pressed state — the panel itself floats independently (see `ReaderScreen`). */
  searchOpen: boolean
  translateActive: boolean
  audioActive: boolean
  audioMenuOpen: boolean
  audioButtonRef: React.Ref<HTMLButtonElement>
  /** Snapshot tool's armed state — the overlay itself floats independently (see `ReaderScreen`). */
  snapshotActive: boolean
  onSnapshot: () => void
  onWordCount: () => void
  /** Annotation tools to omit from the strip entirely — e.g. EPUB has no Freehand/Textbox. */
  hiddenAnnotationTools?: AnnotationTool[]
}

const chromeBtn =
  'inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-lib-border bg-lib-bg-mid/50 px-0 text-lib-muted transition-colors hover:border-lib-accent hover:bg-lib-accent-soft hover:text-lib-text-strong sm:w-auto sm:px-3.5 sm:text-[13px] sm:font-semibold'

export function ReaderTopbar({
  chromeHidden,
  moreOpen,
  settingsOpen,
  activeTool,
  onToggleMore,
  onToggleSettings,
  onSelectTool,
  onCompanionTool,
  onAnnotationTool,
  onShare,
  onFavorites,
  onBookInfo,
  onTrash,
  searchOpen,
  translateActive,
  audioActive,
  audioMenuOpen,
  audioButtonRef,
  snapshotActive,
  onSnapshot,
  onWordCount,
  hiddenAnnotationTools,
}: ReaderTopbarProps) {
  return (
    <header
      id="reader-tools-chrome"
      data-immersive-chrome=""
      className={`absolute inset-x-0 top-0 z-50 flex h-[4.25rem] items-center gap-2 border-b border-lib-border-soft bg-lib-surface-strong px-3 backdrop-blur-md transition-all duration-300 sm:h-[4.5rem] sm:gap-3 sm:px-5 ${
        chromeHidden
          ? 'pointer-events-none -translate-y-full opacity-0'
          : 'translate-y-0 opacity-100'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <ToolsStrip
        activeTool={activeTool}
        onSelectTool={onSelectTool}
        onCompanionTool={onCompanionTool}
        onAnnotationTool={onAnnotationTool}
        searchOpen={searchOpen}
        translateActive={translateActive}
        audioActive={audioActive}
        audioMenuOpen={audioMenuOpen}
        audioButtonRef={audioButtonRef}
        snapshotActive={snapshotActive}
        onSnapshot={onSnapshot}
        onWordCount={onWordCount}
        hiddenAnnotationTools={hiddenAnnotationTools}
      />

      <div className="relative flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          className={`${chromeBtn}${settingsOpen ? ' border-lib-accent bg-lib-accent-soft text-lib-text-strong' : ''}`}
          type="button"
          title="Reading settings"
          aria-label="Reading settings"
          aria-expanded={settingsOpen}
          onClick={(e) => {
            e.stopPropagation()
            onToggleSettings()
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
            stroke="currentColor"
            className="size-5"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            />
          </svg>
          <span className="hidden sm:inline">Settings</span>
        </button>

        <button
          className={`${chromeBtn}${moreOpen ? ' border-lib-accent bg-lib-accent-soft text-lib-text-strong' : ''}`}
          type="button"
          title="More"
          aria-label="More options"
          aria-haspopup="true"
          aria-expanded={moreOpen}
          onClick={(e) => {
            e.stopPropagation()
            onToggleMore()
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="size-5"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z"
            />
          </svg>
        </button>
        <MoreMenu
          open={moreOpen}
          onShare={onShare}
          onFavorites={onFavorites}
          onBookInfo={onBookInfo}
          onTrash={onTrash}
        />
      </div>
    </header>
  )
}
