import { useT } from '../../../../i18n'
import { isMobileHost } from '../../../../platforms/host'

export type ViewMode = 'grid' | 'list'

function GridIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 4.5h6.5v6.5h-6.5v-6.5Zm9.5 0h6.5v6.5h-6.5v-6.5Zm-9.5 9.5h6.5v6.5h-6.5v-6.5Zm9.5 0h6.5v6.5h-6.5v-6.5Z"
      />
    </svg>
  )
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 6.75h15m-15 5.25h15m-15 5.25h15"
      />
    </svg>
  )
}

export type ViewModeToggleProps = {
  viewMode: ViewMode
  onChange: (mode: ViewMode) => void
}

/** Grid/List switch shown on section + collection full-page views. */
export function ViewModeToggle({ viewMode, onChange }: ViewModeToggleProps) {
  const t = useT()
  // Phone: 44 px targets at least 8 px apart (spec 015 FR-005).
  const phone = isMobileHost()
  const size = phone ? 'size-11' : 'size-8'
  return (
    <div
      className={`flex shrink-0 items-center rounded-lg bg-lib-chip/50 p-0.5 ${phone ? 'gap-2' : 'gap-0.5'}`}
      role="group"
      aria-label={t('library.layout.changeViewMode')}
    >
      <button
        type="button"
        aria-pressed={viewMode === 'grid'}
        aria-label={t('library.layout.grid')}
        title={t('library.layout.grid')}
        onClick={() => onChange('grid')}
        className={`inline-flex ${size} cursor-pointer items-center justify-center rounded-md border-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent ${
          viewMode === 'grid'
            ? 'bg-lib-text-strong text-lib-bg-deep'
            : 'bg-transparent text-lib-muted hover:text-lib-text-strong'
        }`}
      >
        <GridIcon className="size-4" />
      </button>
      <button
        type="button"
        aria-pressed={viewMode === 'list'}
        aria-label={t('library.layout.list')}
        title={t('library.layout.list')}
        onClick={() => onChange('list')}
        className={`inline-flex ${size} cursor-pointer items-center justify-center rounded-md border-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent ${
          viewMode === 'list'
            ? 'bg-lib-text-strong text-lib-bg-deep'
            : 'bg-transparent text-lib-muted hover:text-lib-text-strong'
        }`}
      >
        <ListIcon className="size-4" />
      </button>
    </div>
  )
}
