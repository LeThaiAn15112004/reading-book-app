type BookmarkEdgeButtonProps = {
  active: boolean
  onToggle: () => void
}

export function BookmarkEdgeButton({
  active,
  onToggle,
}: BookmarkEdgeButtonProps) {
  return (
    <button
      className={`fixed top-[calc(var(--app-titlebar-h,36px)+56px)] left-0 z-[81] flex h-12 w-9 cursor-pointer items-center justify-center rounded-r-lg border border-l-0 shadow-md transition-[width,color,background] hover:w-[42px] ${
        active
          ? 'border-amber-500/35 bg-amber-500/20 text-amber-400'
          : 'border-slate-600/30 bg-slate-950/75 text-slate-400 hover:bg-slate-950/95 hover:text-amber-400'
      }`}
      type="button"
      title={active ? 'Remove bookmark' : 'Bookmark this chapter'}
      aria-label={active ? 'Remove bookmark' : 'Bookmark this chapter'}
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill={active ? 'currentColor' : 'none'}
        viewBox="0 0 24 24"
        strokeWidth={1.8}
        stroke="currentColor"
        className="size-5"
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"
        />
      </svg>
    </button>
  )
}
