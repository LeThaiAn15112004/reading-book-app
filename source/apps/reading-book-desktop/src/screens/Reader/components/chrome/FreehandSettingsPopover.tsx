import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  PDF_INK_OPERATIONAL_TOOLS,
  PDF_INK_SLIDER_MAX,
  PDF_INK_SLIDER_MIN,
  PDF_INK_SLIDER_STEP,
  inkWidthToPoints,
  parseHexInput,
  usePdfInkPrefsStore,
  type PdfInkTool,
} from '../../logic/pdfInk/pdfInkPrefsStore'
import { useDismissOnOutsideOrEscape } from '../../logic/highlights/useDismissOnOutsideOrEscape'

type FreehandSettingsPopoverProps = {
  anchorRef: RefObject<HTMLElement | null>
  onClose: (refocus: boolean) => void
}

const TOOL_OPTIONS: { id: PdfInkTool; label: string; icon: ReactNode }[] = [
  { id: 'pen', label: 'Pen', icon: <path d="m16.9 3.6 3.5 3.5a1.4 1.4 0 0 1 0 2L8.6 20.9 3 21l.1-5.6L14.9 3.6a1.4 1.4 0 0 1 2 0ZM13.5 5l5.5 5.5" /> },
  { id: 'pencil', label: 'Pencil', icon: <path d="m4 20 1-4L16.5 4.5a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L8 19l-4 1ZM14 7l3 3" /> },
  { id: 'brush', label: 'Brush', icon: <path d="M20 4c-5 1-9 5-10.5 9.5M9.5 13.5C7 13 5 15 5 17.5c0 1.4-.8 2.5-2 3 4 .8 8-1 6.5-7ZM9.5 13.5l1.5 1.5" /> },
  { id: 'marker', label: 'Marker', icon: <path d="m9 11 6-6 4 4-6 6m-4-4-4.5 4.5L3 20l3.8-1.1L11 15m-2-4 4 4M4 21h16" /> },
]

function ToolIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="size-[18px] shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}

const sectionLabel = 'text-[11px] font-semibold uppercase tracking-wide text-lib-muted'

/**
 * Freehand settings (drawing tool, colour, thickness). They apply to the NEXT stroke only — saved
 * strokes keep what they were drawn with. Portalled and fixed-positioned like `ToolGroupMenu`.
 */
export function FreehandSettingsPopover({ anchorRef, onClose }: FreehandSettingsPopoverProps) {
  const popRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const pen = usePdfInkPrefsStore((s) => s.pen)
  const tool = usePdfInkPrefsStore((s) => s.tool)
  const setPenColor = usePdfInkPrefsStore((s) => s.setPenColor)
  const setPenWidth = usePdfInkPrefsStore((s) => s.setPenWidth)
  const setTool = usePdfInkPrefsStore((s) => s.setTool)

  const [hexDraft, setHexDraft] = useState(pen.colorHex.toUpperCase())
  useEffect(() => setHexDraft(pen.colorHex.toUpperCase()), [pen.colorHex])
  const hexValid = parseHexInput(hexDraft) !== null

  const onDismiss = useCallback((reason: 'escape' | 'outside') => onClose(reason === 'escape'), [onClose])
  useDismissOnOutsideOrEscape(popRef, onDismiss, { ignoreRef: anchorRef, consumeEscape: true })

  useLayoutEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    const pop = popRef.current
    if (!rect || !pop) return
    setPos({ left: Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)), top: rect.bottom + 8 })
  }, [anchorRef])

  useEffect(() => {
    const dismiss = () => onClose(false)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
    }
  }, [onClose])

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Freehand settings"
      data-pdf-ink-panel=""
      className="fixed z-[120] flex w-[260px] flex-col gap-3 rounded-xl border border-lib-border bg-lib-surface-strong p-3 shadow-xl backdrop-blur-md"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col gap-1.5">
        <span className={sectionLabel}>Drawing tool</span>
        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Drawing tool">
          {TOOL_OPTIONS.map((opt) => {
            const operational = PDF_INK_OPERATIONAL_TOOLS.includes(opt.id)
            return (
              <button
                key={opt.id}
                type="button"
                disabled={!operational}
                aria-pressed={tool === opt.id}
                title={operational ? opt.label : `${opt.label} — not available yet`}
                onClick={() => setTool(opt.id)}
                className={`flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border border-transparent px-1 py-1.5 text-[11px] font-semibold text-lib-muted hover:border-lib-accent-ring hover:bg-lib-accent-soft hover:text-lib-text-strong disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-transparent disabled:hover:bg-transparent aria-pressed:border-lib-accent aria-pressed:bg-lib-accent-soft aria-pressed:text-lib-accent`}
              >
                <ToolIcon>{opt.icon}</ToolIcon>
                {opt.label}
              </button>
            )
          })}
        </div>
        <span className="text-[11px] text-lib-muted">Only Pen draws for now; the others are not built yet.</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={sectionLabel}>Color</span>
        <div className="flex items-center gap-2">
          <label
            title="Pick a color"
            className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-full border border-lib-border"
            style={{ backgroundColor: pen.colorHex }}
          >
            <input
              type="color"
              aria-label="Pick a color"
              value={pen.colorHex.slice(0, 7).toLowerCase()}
              onChange={(e) => setPenColor(e.target.value.toUpperCase())}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
          <input
            type="text"
            aria-label="Hex color"
            aria-invalid={!hexValid}
            spellCheck={false}
            maxLength={7}
            value={hexDraft}
            onChange={(e) => {
              setHexDraft(e.target.value)
              // Applied live once all six digits are there; `RGB` shorthand is applied on blur.
              if (/^#?[0-9a-f]{6}$/i.test(e.target.value.trim())) setPenColor(parseHexInput(e.target.value)!)
            }}
            onBlur={() => {
              const hex = parseHexInput(hexDraft)
              if (hex) setPenColor(hex)
              setHexDraft((hex ?? pen.colorHex).toUpperCase())
            }}
            className="h-8 w-[96px] rounded-md border border-lib-border-soft bg-transparent px-2 font-mono text-[13px] text-lib-text-strong outline-none focus:border-lib-accent aria-[invalid=true]:border-red-500"
          />
          {!hexValid ? <span role="alert" className="text-[11px] text-red-500">Use #RRGGBB</span> : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="freehand-thickness" className={sectionLabel}>Thickness</label>
          <span className="text-[12px] font-semibold text-lib-text-strong">{inkWidthToPoints(pen.width).toFixed(1)} pt</span>
        </div>
        <input
          id="freehand-thickness"
          type="range"
          min={PDF_INK_SLIDER_MIN}
          max={PDF_INK_SLIDER_MAX}
          step={PDF_INK_SLIDER_STEP}
          value={pen.width}
          onChange={(e) => setPenWidth(Number(e.target.value))}
          className="w-full cursor-pointer accent-[var(--lib-accent,currentColor)]"
        />
      </div>
    </div>
  )
}
