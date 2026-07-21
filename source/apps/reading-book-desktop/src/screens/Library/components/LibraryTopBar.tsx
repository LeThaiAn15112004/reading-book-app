type LibraryTopBarProps = {
  searchQuery: string
  onSearchChange: (value: string) => void
  onAddFile?: () => void
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

/** SCR-01 top bar: search UI (filter in T1.8) + Add file stub (import in G2). */
export function LibraryTopBar({
  searchQuery,
  onSearchChange,
  onAddFile,
}: LibraryTopBarProps) {
  return (
    <header className="relative z-[35] flex h-16 shrink-0 items-center gap-3 border-b border-lib-border-soft bg-lib-topbar px-7 backdrop-blur-sm">
      <div className="relative max-w-80 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-lib-faint" />
        <input
          type="search"
          className="h-[38px] w-full rounded-lg border border-lib-border bg-lib-input py-0 pr-3.5 pl-9 text-sm text-lib-text-strong outline-none transition-[border-color,box-shadow] placeholder:text-lib-faint focus:border-lib-accent focus:shadow-[0_0_0_3px_var(--color-lib-accent-soft)]"
          placeholder="Search imported files…"
          aria-label="Search local library"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <button
        type="button"
        className="inline-flex h-[38px] shrink-0 cursor-pointer items-center gap-2 rounded-lg border-none bg-lib-accent px-4 text-[13px] font-semibold text-lib-bg-deep shadow-[0_4px_14px_rgba(245,158,11,0.22)] transition-colors hover:bg-lib-accent-hover"
        aria-label="Import document from local system"
        onClick={onAddFile}
      >
        <PlusIcon className="size-4" />
        <span>Add file</span>
      </button>
    </header>
  )
}
