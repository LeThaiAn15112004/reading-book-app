import type { HighlightColor, PendingSelection } from '../readerSession'

type SelectionTooltipProps = {
  selection: PendingSelection | null
  onHighlight: (color: HighlightColor) => void
  onNote: () => void
  onCopy: () => void
}

export function SelectionTooltip({
  selection,
  onHighlight,
  onNote,
  onCopy,
}: SelectionTooltipProps) {
  if (!selection) return null

  const top = Math.max(8, selection.rect.top - 48)
  const left = Math.min(
    window.innerWidth - 200,
    Math.max(12, selection.rect.left + selection.rect.width / 2 - 90),
  )

  return (
    <div
      className="fixed z-[200] flex max-w-[calc(100vw-24px)] items-center gap-2.5 rounded-3xl border border-lib-border bg-lib-surface-strong px-3 py-1.5 shadow-xl backdrop-blur-md"
      style={{ top, left }}
      onClick={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label="Selection actions"
    >
      <button
        className="size-6 cursor-pointer rounded-full border border-lib-accent bg-lib-accent/45 p-0 transition-transform hover:scale-110"
        type="button"
        title="Highlight yellow"
        aria-label="Highlight yellow"
        onClick={() => onHighlight('yellow')}
      />
      <button
        className="size-6 cursor-pointer rounded-full border border-emerald-500 bg-emerald-500/45 p-0 transition-transform hover:scale-110"
        type="button"
        title="Highlight green"
        aria-label="Highlight green"
        onClick={() => onHighlight('green')}
      />
      <button
        className="size-6 cursor-pointer rounded-full border border-pink-500 bg-pink-500/45 p-0 transition-transform hover:scale-110"
        type="button"
        title="Highlight pink"
        aria-label="Highlight pink"
        onClick={() => onHighlight('pink')}
      />
      <div className="h-[18px] w-px bg-lib-border" />
      <button
        className="cursor-pointer border-none bg-transparent px-1 py-1.5 text-[13px] font-semibold text-lib-text-strong"
        type="button"
        onClick={onNote}
      >
        Note
      </button>
      <button
        className="cursor-pointer border-none bg-transparent px-1 py-1.5 text-[13px] font-semibold text-lib-text-strong"
        type="button"
        onClick={onCopy}
      >
        Copy
      </button>
    </div>
  )
}
