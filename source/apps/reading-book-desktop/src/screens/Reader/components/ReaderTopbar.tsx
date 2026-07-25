import { Link } from 'react-router-dom'
import type { AnnotateTool } from '../readerSession'
import { TOOL_LABELS } from '../readerSession'
import { MoreMenu } from './MoreMenu'
import { ToolsMenu } from './ToolsMenu'

type ReaderTopbarProps = {
  chapterLabel: string
  chromeHidden: boolean
  toolsOpen: boolean
  moreOpen: boolean
  settingsOpen: boolean
  activeTool: AnnotateTool
  onToggleTools: () => void
  onToggleMore: () => void
  onToggleSettings: () => void
  onSelectTool: (tool: Exclude<AnnotateTool, null>) => void
  onClearTool: () => void
  onOpenSign: () => void
  onShare: () => void
  onFavorites: () => void
  onBookInfo: () => void
  onTrash: () => void
}

const toolBtn =
  'inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-600/45 bg-slate-800/50 px-0 text-slate-400 transition-colors hover:border-amber-500 hover:bg-amber-500/10 hover:text-slate-100 sm:w-auto sm:px-3.5 sm:text-[13px] sm:font-semibold w-10'

export function ReaderTopbar({
  chapterLabel,
  chromeHidden,
  toolsOpen,
  moreOpen,
  settingsOpen,
  activeTool,
  onToggleTools,
  onToggleMore,
  onToggleSettings,
  onSelectTool,
  onClearTool,
  onOpenSign,
  onShare,
  onFavorites,
  onBookInfo,
  onTrash,
}: ReaderTopbarProps) {
  return (
    <header
      className={`relative z-50 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-600/30 bg-slate-900/95 px-4 backdrop-blur-md transition-all duration-300 sm:h-16 sm:px-6 ${
        chromeHidden
          ? 'pointer-events-none -translate-y-full opacity-0'
          : 'translate-y-0 opacity-100'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Link
          to="/library"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/5 hover:text-amber-400"
          title="Back to library"
          aria-label="Back to library"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.2}
            stroke="currentColor"
            className="size-[22px]"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5 8.25 12l7.5-7.5"
            />
          </svg>
        </Link>
        <p className="m-0 max-w-[min(50vw,360px)] truncate text-[13px] font-semibold tracking-wide text-slate-100 uppercase">
          {chapterLabel}
        </p>
      </div>

      <div className="relative flex shrink-0 items-center gap-1.5 sm:gap-2">
        {activeTool ? (
          <button
            className="inline-flex h-9 max-w-[140px] min-w-0 cursor-pointer items-center gap-1.5 rounded-full border border-amber-500/45 bg-amber-500/10 px-3 text-xs font-bold text-amber-400"
            type="button"
            title="Clear tool"
            aria-label={`Clear ${TOOL_LABELS[activeTool]} tool`}
            onClick={(e) => {
              e.stopPropagation()
              onClearTool()
            }}
          >
            <span className="truncate">{TOOL_LABELS[activeTool]}</span>
            <span
              className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[11px]"
              aria-hidden
            >
              ✕
            </span>
          </button>
        ) : null}

        <button
          className={`${toolBtn}${toolsOpen ? ' border-amber-500 bg-amber-500/10 text-slate-100' : ''}`}
          type="button"
          title="Tools"
          aria-label="Annotation tools"
          aria-haspopup="true"
          aria-expanded={toolsOpen}
          onClick={(e) => {
            e.stopPropagation()
            onToggleTools()
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
              d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.05 1.023-.288 1.415-.68l3.97-3.97a.75.75 0 0 0-1.06-1.06l-3.97 3.97c-.392.391-.63.864-.68 1.415m-5.108.233c-.55.05-1.023.288-1.415.68l-3.97 3.97a.75.75 0 1 0 1.06 1.06l3.97-3.97c.392-.391.63-.864.68-1.415"
            />
          </svg>
          <span className="hidden sm:inline">Tools</span>
        </button>
        <ToolsMenu
          open={toolsOpen}
          activeTool={activeTool}
          onSelectTool={onSelectTool}
          onOpenSign={onOpenSign}
        />

        <button
          className={`${toolBtn}${settingsOpen ? ' border-amber-500 bg-amber-500/10 text-slate-100' : ''}`}
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
          className={`${toolBtn}${moreOpen ? ' border-amber-500 bg-amber-500/10 text-slate-100' : ''}`}
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
