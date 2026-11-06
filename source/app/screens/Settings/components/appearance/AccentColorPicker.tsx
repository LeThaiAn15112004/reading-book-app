import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  hexToHsv,
  hsvToHex,
  normalizeHex,
  onAccentColor,
  type Hsv,
} from '../../../../theme/accentColor'

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent'

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** Pointer position inside `el` as 0–1 fractions. */
function fractionIn(el: HTMLElement, e: PointerEvent<HTMLElement>): { x: number; y: number } {
  const rect = el.getBoundingClientRect()
  return {
    x: clamp01((e.clientX - rect.left) / rect.width),
    y: clamp01((e.clientY - rect.top) / rect.height),
  }
}

/** Drag handlers that call `onMove` on press and while the pointer is held (captured). */
function useDrag(onMove: (el: HTMLElement, e: PointerEvent<HTMLElement>) => void) {
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      onMove(e.currentTarget, e)
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) onMove(e.currentTarget, e)
    },
  }
}

export type AccentColorPickerProps = {
  /** Starting color (`#rrggbb`). */
  value: string
  onApply: (hex: string) => void
  onCancel: () => void
}

/**
 * Settings → Appearance → Accent Color → Custom: saturation/brightness area, hue bar and a hex field.
 * Nothing is applied until Apply; Esc / Cancel / clicking outside discards the draft.
 */
export function AccentColorPicker({ value, onApply, onCancel }: AccentColorPickerProps) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value))
  const [hexText, setHexText] = useState(value)
  const panelRef = useRef<HTMLDivElement>(null)
  const hexId = useId()
  const errorId = useId()

  const parsedHex = normalizeHex(hexText)
  const color = parsedHex ?? hsvToHex(hsv)

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    // Outside = outside the anchor wrapper too, so the swatch that opened the panel toggles it.
    function onPointerDown(e: globalThis.PointerEvent) {
      const scope = panelRef.current?.parentElement ?? panelRef.current
      if (scope && !scope.contains(e.target as Node)) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onCancel])

  /** Picker moved: HSV is the source of truth (keeps hue at zero saturation), hex follows. */
  function updateHsv(next: Hsv) {
    setHsv(next)
    setHexText(hsvToHex(next))
  }

  function onHexChange(text: string) {
    setHexText(text)
    const hex = normalizeHex(text)
    if (hex) {
      const next = hexToHsv(hex)
      // Grey / black carry no hue — keep the current one so the hue bar doesn't jump.
      setHsv(next.s === 0 || next.v === 0 ? { ...next, h: hsv.h } : next)
    }
  }

  function apply() {
    if (parsedHex) onApply(parsedHex)
  }

  const svDrag = useDrag((el, e) => {
    const { x, y } = fractionIn(el, e)
    updateHsv({ ...hsv, s: x, v: 1 - y })
  })
  const hueDrag = useDrag((el, e) => {
    const { x } = fractionIn(el, e)
    updateHsv({ ...hsv, h: Math.min(359.9, x * 360) })
  })

  function onSvKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 0.1 : 0.02
    const delta: Record<string, Partial<Hsv>> = {
      ArrowLeft: { s: clamp01(hsv.s - step) },
      ArrowRight: { s: clamp01(hsv.s + step) },
      ArrowUp: { v: clamp01(hsv.v + step) },
      ArrowDown: { v: clamp01(hsv.v - step) },
    }
    if (!delta[e.key]) return
    e.preventDefault()
    updateHsv({ ...hsv, ...delta[e.key] })
  }

  function onHueKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 15 : 3
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const h = hsv.h + (e.key === 'ArrowRight' ? step : -step)
    updateHsv({ ...hsv, h: Math.min(359.9, Math.max(0, h)) })
  }

  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 })

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Custom accent color"
      className="absolute top-full right-0 z-20 mt-2 w-64 rounded-xl border border-lib-border bg-lib-surface-strong p-3 shadow-xl"
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        aria-valuenow={Math.round(hsv.s * 100)}
        className={`relative h-36 w-full cursor-crosshair touch-none rounded-lg ${focusRing}`}
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
        }}
        onKeyDown={onSvKey}
        {...svDrag}
      >
        <span
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }}
          aria-hidden
        />
      </div>

      <div
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        className={`relative mt-3 h-3 w-full cursor-pointer touch-none rounded-full ${focusRing}`}
        style={{
          background:
            'linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00)',
        }}
        onKeyDown={onHueKey}
        {...hueDrag}
      >
        <span
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
          style={{ left: `${(hsv.h / 360) * 100}%`, background: hueColor }}
          aria-hidden
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span
          className="size-8 shrink-0 rounded-lg border border-lib-border"
          style={{ background: color }}
          aria-hidden
        />
        <label htmlFor={hexId} className="sr-only">
          Hex color
        </label>
        <input
          id={hexId}
          type="text"
          inputMode="text"
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          value={hexText}
          aria-invalid={!parsedHex}
          aria-describedby={parsedHex ? undefined : errorId}
          className={`h-8 min-w-0 flex-1 rounded-lg border bg-lib-bg-deep/40 px-2.5 font-mono text-[13px] text-lib-text-strong uppercase outline-none select-text focus:border-lib-accent ${
            parsedHex ? 'border-lib-border' : 'border-red-400'
          }`}
          onChange={(e) => onHexChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              apply()
            }
          }}
        />
      </div>
      {parsedHex ? null : (
        <p id={errorId} className="m-0 mt-1.5 text-[11px] text-red-400">
          Enter a hex color like #3B82F6 or #38F.
        </p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className={`h-8 cursor-pointer rounded-lg border border-lib-border bg-transparent px-3 text-[12px] font-semibold text-lib-muted hover:text-lib-text-strong ${focusRing}`}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!parsedHex}
          className={`h-8 cursor-pointer rounded-lg border border-transparent px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
          style={{ background: color, color: onAccentColor(color) }}
          onClick={apply}
        >
          Apply
        </button>
      </div>
    </div>
  )
}
