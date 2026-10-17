type SyncConflictBannerProps = {
  kind: 'both-changed' | 'removed-in-file'
  onKeepReadmate: () => void
  onUsePdf: () => void
}

/**
 * Shown on an annotation that Readmate and another PDF app both changed (two-way sync,
 * docs/implementation_plan/pdf_annotation_two_way_sync.md §5). Neither version was overwritten;
 * the user picks one.
 */
export function SyncConflictBanner({ kind, onKeepReadmate, onUsePdf }: SyncConflictBannerProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-400/50 bg-amber-400/10 p-2 text-xs leading-snug text-lib-text" role="alert" aria-label="Sync conflict">
      <span>
        {kind === 'removed-in-file'
          ? 'Another app deleted this annotation from the PDF, but you changed it in Readmate.'
          : 'This annotation was changed in Readmate and in another app.'}
      </span>
      <div className="flex gap-1.5">
        <button
          type="button"
          className="h-8 flex-1 cursor-pointer rounded-md border border-lib-accent bg-lib-accent-soft px-2 font-semibold text-lib-text-strong"
          onClick={onKeepReadmate}
        >
          Keep Readmate’s
        </button>
        <button
          type="button"
          className="h-8 flex-1 cursor-pointer rounded-md border border-lib-border bg-lib-bg-mid/50 px-2 font-semibold text-lib-text"
          onClick={onUsePdf}
        >
          {kind === 'removed-in-file' ? 'Delete it' : 'Use the PDF’s'}
        </button>
      </div>
    </div>
  )
}
