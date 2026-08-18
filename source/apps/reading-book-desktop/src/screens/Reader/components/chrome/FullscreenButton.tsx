type FullscreenButtonProps = {
  fullscreen: boolean
  onToggle: () => void
}

/** Four outward corner arrows — enter fullscreen. */
function ExpandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9" />
      <path d="M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15" />
      <path d="M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9" />
      <path d="M20.25 20.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
    </svg>
  )
}

/** Four inward corner arrows — exit fullscreen. */
function CompressIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 9H4.5M9 9V4.5M9 9L3.75 3.75" />
      <path d="M15 9h4.5M15 9V4.5M15 9l5.25-5.25" />
      <path d="M9 15H4.5M9 15v4.5M9 15l-5.25 5.25" />
      <path d="M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
    </svg>
  )
}

export function FullscreenButton({
  fullscreen,
  onToggle,
}: FullscreenButtonProps) {
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center rounded px-2 py-1 text-lib-text-strong hover:bg-lib-chip"
      title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen (F11)'}
      aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'}
      aria-pressed={fullscreen}
      onClick={onToggle}
    >
      {fullscreen ? <CompressIcon /> : <ExpandIcon />}
    </button>
  )
}
