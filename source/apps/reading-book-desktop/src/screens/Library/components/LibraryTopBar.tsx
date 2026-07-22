import { ImportMenu } from '../../../components/import'

type LibraryTopBarProps = {
  searchQuery: string
  onSearchChange: (value: string) => void
  onFromDevice: () => void
  onFromUrl: () => void
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

/** SCR-01 top bar: search + UX-IMP entry (Add file / Import URL). */
export function LibraryTopBar({
  searchQuery,
  onSearchChange,
  onFromDevice,
  onFromUrl,
}: LibraryTopBarProps) {
  return (
    <header className="relative z-[35] flex h-16 shrink-0 items-center gap-2 border-b border-lib-border-soft bg-lib-topbar px-4 backdrop-blur-sm sm:gap-3 sm:px-7">
      <div className="relative min-w-0 max-w-80 flex-1">
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

      <ImportMenu
        size="md"
        onFromDevice={onFromDevice}
        onFromUrl={onFromUrl}
      />
    </header>
  )
}
