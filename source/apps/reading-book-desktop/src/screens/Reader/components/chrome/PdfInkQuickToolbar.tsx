import { useEffect, useState } from 'react'
import { parseHexInput } from '../../logic/pdfInk/pdfInkPrefsStore'

type PdfInkQuickToolbarProps = {
  colorHex: string
  onColor: (colorHex: string) => void
  onDelete: () => void
}

/**
 * The compact toolbar next to a selected stroke: its `#RRGGBB` colour and Delete. One undo step per applied
 * colour (on Enter / blur), never per keystroke. The full style panel stays the place for thickness etc.
 */
export function PdfInkQuickToolbar({ colorHex, onColor, onDelete }: PdfInkQuickToolbarProps) {
  const hex = colorHex.toUpperCase()
  const [draft, setDraft] = useState(hex)
  useEffect(() => setDraft(hex), [hex])
  const valid = parseHexInput(draft) !== null
  const apply = () => {
    const parsed = parseHexInput(draft)
    if (parsed) onColor(parsed)
    setDraft((parsed ?? hex).toUpperCase())
  }
  return (
    <div
      role="toolbar"
      aria-label="Stroke tools"
      className="flex items-center gap-1.5 rounded-lg border border-lib-border bg-lib-surface-strong p-1.5 shadow-lg"
    >
      <span aria-hidden className="size-5 shrink-0 rounded-full border border-lib-border" style={{ backgroundColor: valid ? (parseHexInput(draft) ?? hex) : hex }} />
      <input
        type="text"
        aria-label="Stroke hex color"
        aria-invalid={!valid}
        spellCheck={false}
        maxLength={7}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            apply()
            e.currentTarget.blur()
          }
        }}
        className="h-7 w-[84px] rounded-md border border-lib-border-soft bg-transparent px-2 font-mono text-[12px] text-lib-text-strong outline-none select-text focus:border-lib-accent aria-[invalid=true]:border-red-500"
      />
      <button
        type="button"
        aria-label="Delete stroke"
        title="Delete"
        onClick={onDelete}
        className="flex size-7 cursor-pointer items-center justify-center rounded-md text-lib-text-strong hover:bg-lib-accent-soft"
      >
        <svg className="size-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v6m4-6v6" />
        </svg>
      </button>
    </div>
  )
}
