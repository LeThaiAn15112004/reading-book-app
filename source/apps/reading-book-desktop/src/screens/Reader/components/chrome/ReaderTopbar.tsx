import type { Ref } from 'react'
import type { ReaderCapability } from '../../../../reader/capabilities'
import { MoreMenu } from './MoreMenu'
import { ToolsStrip, type ToolId, type ToolStates } from './ToolsMenu'

type ReaderTopbarProps = {
  chromeHidden: boolean
  moreOpen: boolean
  onToggleMore: () => void
  onShare: () => void
  onFavorites: () => void
  onBookInfo: () => void
  onTrash: () => void
  /** What the open book's reader surface supports; unsupported tools are not rendered. */
  capabilities: ReadonlySet<ReaderCapability>
  /** Active / expanded state per tool (see `ToolsStrip`). */
  toolStates: ToolStates
  onTool: (tool: ToolId) => void
  /** The read-aloud menu floats under the Audio button. */
  audioButtonRef: Ref<HTMLButtonElement>
}

const chromeBtn =
  'inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-lib-border bg-lib-bg-mid/50 px-0 text-lib-muted transition-colors hover:border-lib-accent hover:bg-lib-accent-soft hover:text-lib-text-strong sm:w-auto sm:px-3.5 sm:text-[13px] sm:font-semibold'

export function ReaderTopbar({
  chromeHidden,
  moreOpen,
  onToggleMore,
  onShare,
  onFavorites,
  onBookInfo,
  onTrash,
  capabilities,
  toolStates,
  onTool,
  audioButtonRef,
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
        capabilities={capabilities}
        toolStates={toolStates}
        onTool={onTool}
        toolRefs={{ speech: audioButtonRef }}
        hidden={chromeHidden}
      />

      <div className="relative flex shrink-0 items-center gap-1.5 sm:gap-2">
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
