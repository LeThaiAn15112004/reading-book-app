import { useEffect, useId, useRef, useState } from 'react'
import {
  ZOOM_LAYOUT_PRESETS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PERCENT_PRESETS,
  formatZoomPercent,
  parseZoomPercentInput,
  type ZoomLayoutPreset,
} from '../../logic'

type ZoomControlProps = {
  zoom: number
  onZoomChange: (scale: number) => void
  onZoomStep: (direction: 1 | -1) => void
  onLayoutPreset: (preset: ZoomLayoutPreset) => void
}

export function ZoomControl({
  zoom,
  onZoomChange,
  onZoomStep,
  onLayoutPreset,
}: ZoomControlProps) {
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState(formatZoomPercent(zoom))
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    setInput(formatZoomPercent(zoom))
  }, [zoom])

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [menuOpen])

  function submitInput() {
    const next = parseZoomPercentInput(input)
    if (next == null) {
      setInput(formatZoomPercent(zoom))
      return
    }
    onZoomChange(next)
    setInput(formatZoomPercent(next))
  }

  const atMin = zoom <= ZOOM_MIN + 1e-9
  const atMax = zoom >= ZOOM_MAX - 1e-9

  return (
    <div
      ref={rootRef}
      className="relative inline-flex items-center gap-0.5 text-xs font-semibold tracking-wide text-lib-text-strong"
    >
      <button
        type="button"
        className="rounded px-2 py-1 text-sm hover:bg-lib-chip disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Zoom out"
        disabled={atMin}
        onClick={() => onZoomStep(-1)}
      >
        −
      </button>

      <div className="inline-flex items-stretch overflow-hidden rounded border border-lib-border-soft bg-lib-bg-mid/40">
        <input
          type="text"
          inputMode="decimal"
          aria-label="Zoom percentage"
          className="w-[4.5rem] bg-transparent px-1.5 py-1 text-right outline-none focus:bg-lib-chip"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={submitInput}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submitInput()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              setInput(formatZoomPercent(zoom))
              event.currentTarget.blur()
            }
          }}
        />
        <span className="flex items-center pr-1 text-lib-muted" aria-hidden>
          %
        </span>
        <button
          type="button"
          className="border-l border-lib-border-soft px-1.5 text-[10px] text-lib-muted hover:bg-lib-chip hover:text-lib-text-strong"
          aria-label="Zoom presets"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((v) => !v)}
        >
          ▾
        </button>
      </div>

      <button
        type="button"
        className="rounded px-2 py-1 text-sm hover:bg-lib-chip disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Zoom in"
        disabled={atMax}
        onClick={() => onZoomStep(1)}
      >
        +
      </button>

      {menuOpen ? (
        <div
          id={menuId}
          role="menu"
          className="app-scroll absolute bottom-[calc(100%+6px)] left-1/2 z-[120] max-h-72 w-44 -translate-x-1/2 overflow-y-auto rounded-lg border border-lib-border bg-lib-surface-strong py-1 shadow-xl"
        >
          {ZOOM_LAYOUT_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer border-none bg-transparent px-3 py-1.5 text-left text-xs font-semibold text-lib-text-strong hover:bg-lib-chip"
              onClick={() => {
                onLayoutPreset(item.id)
                setMenuOpen(false)
              }}
            >
              {item.label}
            </button>
          ))}
          <div className="my-1 border-t border-lib-border-soft" role="separator" />
          {ZOOM_PERCENT_PRESETS.map((pct) => {
            const active = Math.abs(zoom * 100 - pct) < 0.05
            return (
              <button
                key={pct}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`flex w-full cursor-pointer border-none px-3 py-1.5 text-left text-xs font-semibold hover:bg-lib-chip ${
                  active
                    ? 'bg-lib-accent-soft text-lib-accent'
                    : 'bg-transparent text-lib-text-strong'
                }`}
                onClick={() => {
                  onZoomChange(pct / 100)
                  setMenuOpen(false)
                }}
              >
                {`${pct}%`}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
