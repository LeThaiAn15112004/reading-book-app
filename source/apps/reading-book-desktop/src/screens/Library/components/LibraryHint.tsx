/** MVP format chips shown on SCR-01 (SDS / library mockup — no DOCX). */
const MVP_FORMAT_CHIPS = ['EPUB', 'PDF', 'TXT', 'MD', 'DOCX', 'DOC'] as const

/** Local-library hint + supported format chips. */
export function LibraryHint() {
  return (
    <div className="mb-7 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-[10px] border border-dashed border-lib-border bg-lib-hint px-3.5 py-3">
      <div className="min-w-0">
        <p className="mb-0.5 text-[13px] font-semibold text-lib-text-strong">
          Your library on this device
        </p>
        <p className="text-xs leading-snug text-lib-faint">
          Only files you imported from your device. MVP supports 4 formats (covers most
          real-world needs):
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Supported formats">
        {MVP_FORMAT_CHIPS.map((format) => (
          <span
            key={format}
            className="rounded border border-lib-border-soft bg-lib-chip px-1.5 py-1 text-[10px] font-bold tracking-wide text-lib-muted"
          >
            {format}
          </span>
        ))}
      </div>
    </div>
  )
}
