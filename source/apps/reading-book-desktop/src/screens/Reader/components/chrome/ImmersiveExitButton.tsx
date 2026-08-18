type ImmersiveExitButtonProps = {
  onExit: () => void
}

/**
 * Slim tab docked to the right screen edge so it never covers book text.
 * Esc / F11 also exit; this is a discoverable affordance only.
 */
export function ImmersiveExitButton({ onExit }: ImmersiveExitButtonProps) {
  return (
    <button
      type="button"
      data-immersive-chrome=""
      className="fixed top-1/2 right-0 z-[220] flex h-16 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-l-md border border-r-0 border-lib-border-soft bg-lib-surface-strong/85 text-lib-muted shadow-md backdrop-blur-md transition-colors hover:w-8 hover:border-lib-accent-ring hover:bg-lib-accent-soft hover:text-lib-accent"
      title="Exit full screen (Esc)"
      aria-label="Exit full screen"
      onClick={(e) => {
        e.stopPropagation()
        onExit()
      }}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-3.5 shrink-0"
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
    </button>
  )
}
