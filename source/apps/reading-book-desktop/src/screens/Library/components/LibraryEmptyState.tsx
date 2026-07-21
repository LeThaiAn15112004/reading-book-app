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
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4.5v15m7.5-7.5h-15"
      />
    </svg>
  )
}

type LibraryEmptyStateProps = {
  onAddFile: () => void
}

/** SCR-01 empty library: large Add file CTA (FR-08 / T1.4). Import wiring lands in G2. */
export function LibraryEmptyState({ onAddFile }: LibraryEmptyStateProps) {
  return (
    <section
      className="flex flex-col items-center justify-center px-6 py-16 text-center"
      aria-label="Empty library"
    >
      <h2 className="mb-2 text-xl font-semibold tracking-tight text-lib-text-strong">
        No files in your library yet
      </h2>
      <p className="mb-8 max-w-md text-sm leading-relaxed text-lib-muted">
        Import EPUB, PDF, TXT, or Markdown from your device. Files stay on this machine —
        no bookstore.
      </p>
      <button
        type="button"
        className="inline-flex h-12 cursor-pointer items-center gap-2.5 rounded-xl border-none bg-lib-accent px-7 text-[15px] font-semibold text-lib-bg-deep shadow-[0_6px_20px_rgba(245,158,11,0.28)] transition-colors hover:bg-lib-accent-hover"
        aria-label="Add file to library"
        onClick={onAddFile}
      >
        <PlusIcon className="size-5" />
        <span>Add file</span>
      </button>
    </section>
  )
}
