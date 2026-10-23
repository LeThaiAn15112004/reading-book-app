type PdfInkPanelProps = {
  onDeleteSelected: () => void
}

/**
 * Delete button while a stroke is selected (also the Delete key). Pen settings (tool, colour,
 * thickness) live in the toolbar's Freehand menu — see `FreehandSettingsPopover`.
 */
export function PdfInkPanel({ onDeleteSelected }: PdfInkPanelProps) {
  return (
    <div
      role="toolbar"
      aria-label="Selected stroke"
      data-pdf-ink-panel=""
      className="fixed bottom-14 left-1/2 z-[120] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-lib-border bg-lib-surface-strong px-3 py-2 shadow-xl backdrop-blur-md"
    >
      <button
        type="button"
        onClick={onDeleteSelected}
        className="cursor-pointer rounded-md px-2 py-1 text-[13px] font-semibold text-lib-text-strong hover:bg-lib-accent-soft"
      >
        Delete stroke
      </button>
    </div>
  )
}
