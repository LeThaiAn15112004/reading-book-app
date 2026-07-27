type ChromeRevealButtonProps = {
  expanded: boolean
  onToggle: () => void
}

/** Down/up chevron to show or hide the Reader tools topbar. */
export function ChromeRevealButton({
  expanded,
  onToggle,
}: ChromeRevealButtonProps) {
  return (
    <button
      type="button"
      className={`absolute left-1/2 z-[60] flex h-7 w-10 -translate-x-1/2 cursor-pointer items-center justify-center rounded-b-lg border border-t-0 border-lib-border bg-lib-surface-strong text-lib-muted shadow-md backdrop-blur-md transition-[top,color,border-color] hover:border-lib-accent-ring hover:text-lib-accent ${
        expanded ? 'top-14 sm:top-16' : 'top-0'
      }`}
      title={expanded ? 'Hide tools' : 'Show tools'}
      aria-label={expanded ? 'Hide tools bar' : 'Show tools bar'}
      aria-expanded={expanded}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2.4}
        stroke="currentColor"
        className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m19.5 8.25-7.5 7.5-7.5-7.5"
        />
      </svg>
    </button>
  )
}
