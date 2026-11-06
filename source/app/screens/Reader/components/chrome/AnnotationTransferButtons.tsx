type AnnotationTransferButtonsProps = {
  /** PDF only: save a new PDF with the annotations written in. Hidden when absent. */
  onExportPdf?: () => void
  /** EPUB / PDF / TXT / Markdown: save the book's annotations to a `.readmate-notes.json` file. Hidden when absent. */
  onExportAnnotations?: () => void
  /** Save a readable Markdown copy (quotes and comments in reading order). Hidden when absent. */
  onExportReadable?: () => void
  /** Pick a `.readmate-notes.json` file and import its annotations into this book. Hidden when absent. */
  onImportAnnotations?: () => void
}

const buttonClass =
  'inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-transparent text-lib-muted transition-colors hover:border-lib-accent-ring hover:bg-lib-accent-soft hover:text-lib-text-strong'

const icon = { xmlns: 'http://www.w3.org/2000/svg', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 1.8, stroke: 'currentColor', className: 'size-[18px]' } as const

/** A page with an arrow leaving it (export), or entering it (import). */
function PageIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg {...icon} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V6.75L14.25 3Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 3v3.75H18" />
      {children}
    </svg>
  )
}

/**
 * Export / import of the open book's annotations, one click each in the Reader toolbar (they used to sit in the More menu).
 * Icon-only like the markup tools; the tooltip names the action. Hidden for books that cannot carry annotations.
 */
export function AnnotationTransferButtons({ onExportPdf, onExportAnnotations, onExportReadable, onImportAnnotations }: AnnotationTransferButtonsProps) {
  if (!onExportPdf && !onExportAnnotations && !onExportReadable && !onImportAnnotations) return null
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-l border-lib-border pl-1.5 sm:pl-2" role="group" aria-label="Export and import annotations">
      {onExportPdf ? (
        <button type="button" className={buttonClass} title="Export PDF with annotations…" aria-label="Export PDF with annotations" onClick={onExportPdf}>
          <PageIcon>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 17.25v-6m0 0-2.25 2.25M12 11.25l2.25 2.25" />
          </PageIcon>
        </button>
      ) : null}
      {onExportAnnotations ? (
        <button type="button" className={buttonClass} title="Export annotations (backup)…" aria-label="Export annotations (backup)" onClick={onExportAnnotations}>
          <svg {...icon} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0-3.75-3.75M12 15l3.75-3.75M4.5 16.5v1.75A1.75 1.75 0 0 0 6.25 20h11.5a1.75 1.75 0 0 0 1.75-1.75V16.5" />
          </svg>
        </button>
      ) : null}
      {onExportReadable ? (
        <button type="button" className={buttonClass} title="Export readable copy…" aria-label="Export readable copy" onClick={onExportReadable}>
          <PageIcon>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6M9 15h6M9 18h3.5" />
          </PageIcon>
        </button>
      ) : null}
      {onImportAnnotations ? (
        <button type="button" className={buttonClass} title="Import annotations…" aria-label="Import annotations" onClick={onImportAnnotations}>
          <svg {...icon} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15V3m0 0L8.25 6.75M12 3l3.75 3.75M4.5 16.5v1.75A1.75 1.75 0 0 0 6.25 20h11.5a1.75 1.75 0 0 0 1.75-1.75V16.5" />
          </svg>
        </button>
      ) : null}
    </div>
  )
}
