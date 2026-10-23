import { useEffect, useRef, useState, type ReactNode } from 'react'
import { INK_PEN_PRESETS, INK_PEN_STYLES, type InkPenStyle } from '@reading-book/book-reader-sdk'
import { pickerEventAction, setInkColorPickerOpen } from './inkColorPickerState'
import { inkWidthToPoints, parseHexInput } from '../../logic/pdfInk/pdfInkPrefsStore'

const STYLE_ICONS: Record<InkPenStyle, ReactNode> = {
  pen: <path d="m16.9 3.6 3.5 3.5a1.4 1.4 0 0 1 0 2L8.6 20.9 3 21l.1-5.6L14.9 3.6a1.4 1.4 0 0 1 2 0ZM13.5 5l5.5 5.5" />,
  pencil: <path d="m4 20 1-4L16.5 4.5a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L8 19l-4 1ZM14 7l3 3" />,
  marker: <path d="m9 11 6-6 4 4-6 6m-4-4-4.5 4.5L3 20l3.8-1.1L11 15m-2-4 4 4M4 21h16" />,
  brush: <path d="M20 4c-5 1-9 5-10.5 9.5M9.5 13.5C7 13 5 15 5 17.5c0 1.4-.8 2.5-2 3 4 .8 8-1 6.5-7ZM9.5 13.5l1.5 1.5" />,
}

const sectionLabel = 'text-[11px] font-semibold uppercase tracking-wide text-lib-muted'

/** The colour row — the system picker plus a `#RRGGBB` field. Shared by the Freehand and Shape settings. */
export function InkColorControl({ colorHex, onColor, live = false }: { colorHex: string; onColor: (colorHex: string) => void; live?: boolean }) {
  const hex = colorHex.toUpperCase()
  const [hexDraft, setHexDraft] = useState(hex)
  useEffect(() => setHexDraft(hex), [hex])
  const hexValid = parseHexInput(hexDraft) !== null

  // The system colour picker fires `input` while dragging and `change` when it closes: only the latter is a commit.
  const pickerRef = useRef<HTMLInputElement | null>(null)
  const onColorRef = useRef(onColor)
  onColorRef.current = onColor
  const [pickerLive, setPickerLive] = useState<string | null>(null)
  useEffect(() => {
    const el = pickerRef.current
    if (!el) return
    const apply = (event: 'input' | 'change') => {
      const action = pickerEventAction(event, live)
      const value = el.value.toUpperCase()
      setPickerLive(action.preview ? value : null)
      if (action.commit) onColorRef.current(value)
    }
    const onInput = () => apply('input')
    const done = () => {
      setInkColorPickerOpen(false)
      apply('change')
    }
    const opened = () => {
      setInkColorPickerOpen(true)
    }
    // The window regains focus when the dialog closes (with or without a change): leave the guard a moment later.
    const refocused = () => {
      setTimeout(() => {
        setInkColorPickerOpen(false)
      }, 300)
    }
    el.addEventListener('click', opened)
    el.addEventListener('input', onInput)
    el.addEventListener('change', done)
    window.addEventListener('focus', refocused)
    return () => {
      el.removeEventListener('click', opened)
      el.removeEventListener('input', onInput)
      el.removeEventListener('change', done)
      window.removeEventListener('focus', refocused)
    }
  }, [live])

  return (
    <div className="flex flex-col gap-1.5">
      <span className={sectionLabel}>Color</span>
      <div className="flex items-center gap-2">
        <label
          title="Pick a color"
          className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-full border border-lib-border"
          style={{ backgroundColor: pickerLive ?? hex }}
        >
          <input
            ref={pickerRef}
            type="color"
            aria-label="Pick a color"
            // Controlled by the LIVE pick too: re-rendering with the saved colour while the picker is open
            // would put the old value back before its `change` event reads it (the colour never changed).
            value={(pickerLive ?? hex).toLowerCase()}
            onChange={() => {}}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <input
          type="text"
          aria-label="Hex color"
          aria-invalid={!hexValid}
          spellCheck={false}
          maxLength={7}
          value={pickerLive ?? hexDraft}
          onChange={(e) => {
            setHexDraft(e.target.value)
            // Applied live once all six digits are there; `RGB` shorthand is applied on blur.
            if (/^#?[0-9a-f]{6}$/i.test(e.target.value.trim())) onColor(parseHexInput(e.target.value)!)
          }}
          onBlur={() => {
            const parsed = parseHexInput(hexDraft)
            if (parsed) onColor(parsed)
            setHexDraft((parsed ?? hex).toUpperCase())
          }}
          className="h-8 w-[96px] rounded-md border border-lib-border-soft bg-transparent px-2 font-mono text-[13px] text-lib-text-strong outline-none focus:border-lib-accent aria-[invalid=true]:border-red-500"
        />
        {!hexValid ? (
          <span role="alert" className="text-[11px] text-red-500">
            Use #RRGGBB
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** Slider that shows the value live but only reports it on release (one commit, not one per pixel). */
export function CommitSlider({
  id,
  min,
  max,
  step,
  value,
  onCommit,
  onDraft,
}: {
  id: string
  min: number
  max: number
  step: number
  value: number
  onCommit: (value: number) => void
  onDraft: (value: number | null) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    onDraft(null)
    if (draft !== value) onCommit(draft)
  }
  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => {
        setDraft(Number(e.target.value))
        onDraft(Number(e.target.value))
      }}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
      className="w-full cursor-pointer accent-[var(--lib-accent,currentColor)]"
    />
  )
}

type InkStyleControlsProps = {
  /** Makes the control ids unique when two sets are on screen. */
  idPrefix: string
  style: InkPenStyle
  colorHex: string
  /** Fraction of the page width. */
  width: number
  opacity: number
  onStyle: (style: InkPenStyle) => void
  onColor: (colorHex: string) => void
  onWidth: (width: number) => void
  onOpacity: (opacity: number) => void
  /** The colour edits the NEXT drawing's settings (applied as it is picked) rather than one existing object. */
  liveColor?: boolean
}

/**
 * Drawing style (Pen / Pencil / Marker), colour (picker + `#RRGGBB`), thickness and — for Pencil and Marker —
 * opacity. Used by the Freehand dropdown (settings of the NEXT stroke) and by the selected-stroke panel
 * (edit of that one stroke); the caller decides what each change applies to.
 */
export function InkStyleControls({ idPrefix, style, colorHex, width, opacity, onStyle, onColor, onWidth, onOpacity, liveColor = false }: InkStyleControlsProps) {
  const preset = INK_PEN_PRESETS[style]
  const [widthLive, setWidthLive] = useState<number | null>(null)
  const [opacityLive, setOpacityLive] = useState<number | null>(null)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className={sectionLabel}>Drawing style</span>
        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Drawing style">
          {INK_PEN_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={style === s}
              data-ink-style-option={s}
              onClick={() => onStyle(s)}
              className="flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border border-transparent px-1 py-1.5 text-[11px] font-semibold text-lib-muted hover:border-lib-accent-ring hover:bg-lib-accent-soft hover:text-lib-text-strong aria-pressed:border-lib-accent aria-pressed:bg-lib-accent-soft aria-pressed:text-lib-accent"
            >
              <svg className="size-[18px] shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {STYLE_ICONS[s]}
              </svg>
              {INK_PEN_PRESETS[s].label}
            </button>
          ))}
        </div>
      </div>

      <InkColorControl colorHex={colorHex} onColor={onColor} live={liveColor} />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor={`${idPrefix}-thickness`} className={sectionLabel}>
            Thickness
          </label>
          <span className="text-[12px] font-semibold text-lib-text-strong">{inkWidthToPoints(widthLive ?? width).toFixed(1)} pt</span>
        </div>
        <CommitSlider
          id={`${idPrefix}-thickness`}
          min={preset.widthMin}
          max={preset.widthMax}
          step={0.0005}
          value={width}
          onCommit={onWidth}
          onDraft={setWidthLive}
        />
      </div>

      {preset.opacityEditable ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor={`${idPrefix}-opacity`} className={sectionLabel}>
              Opacity
            </label>
            <span className="text-[12px] font-semibold text-lib-text-strong">{Math.round((opacityLive ?? opacity) * 100)}%</span>
          </div>
          <CommitSlider
            id={`${idPrefix}-opacity`}
            min={preset.opacityMin}
            max={preset.opacityMax}
            step={0.05}
            value={opacity}
            onCommit={onOpacity}
            onDraft={setOpacityLive}
          />
        </div>
      ) : (
        <span className="text-[11px] text-lib-muted">The Pen is always fully opaque.</span>
      )}
    </div>
  )
}
