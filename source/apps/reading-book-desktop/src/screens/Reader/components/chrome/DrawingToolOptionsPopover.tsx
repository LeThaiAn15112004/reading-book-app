import { useEffect, useRef } from 'react'
import {
  DRAW_COLOR_SWATCHES,
  DRAW_STROKE_WIDTHS,
  type DrawToolSettings,
  type DrawingTool,
} from '@reading-book/shared/models'

type DrawingToolOptionsPopoverProps = {
  tool: DrawingTool
  anchorEl: HTMLElement | null
  settings: DrawToolSettings
  onChange: (patch: Partial<DrawToolSettings>) => void
  onClose: () => void
}

function popoverPosition(anchor: HTMLElement): { top: number; left: number } {
  const rect = anchor.getBoundingClientRect()
  const width = 168
  const left = Math.min(
    Math.max(rect.left + rect.width / 2 - width / 2, 8),
    window.innerWidth - width - 8,
  )
  return { top: rect.bottom + 6, left }
}

/** Compact stroke + color picker for Pencil / Shape (double-click toolbar). */
export function DrawingToolOptionsPopover({
  tool,
  anchorEl,
  settings,
  onChange,
  onClose,
}: DrawingToolOptionsPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!anchorEl) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node | null
      if (
        panelRef.current?.contains(target) ||
        anchorEl?.contains(target)
      ) {
        return
      }
      onClose()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [anchorEl, onClose])

  if (!anchorEl) return null

  const { top, left } = popoverPosition(anchorEl)
  const title = tool === 'pencil' ? 'Pencil options' : 'Shape options'

  return (
    <div
      ref={panelRef}
      className="fixed z-[120] w-[168px] rounded-xl border border-lib-border-soft bg-lib-surface-strong p-2.5 shadow-lg backdrop-blur-md"
      style={{ top, left }}
      role="dialog"
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="mb-2 text-[11px] font-semibold tracking-wide text-lib-muted uppercase">
        Stroke
      </p>
      <div className="mb-3 flex items-center justify-between gap-1">
        {DRAW_STROKE_WIDTHS.map((width) => {
          const active = settings.strokeWidth === width
          return (
            <button
              key={width}
              type="button"
              title={`${width}px`}
              aria-label={`Stroke width ${width}px`}
              aria-pressed={active}
              className={`flex size-7 cursor-pointer items-center justify-center rounded-md border transition-colors ${
                active
                  ? 'border-lib-accent bg-lib-accent-soft text-lib-accent'
                  : 'border-transparent text-lib-muted hover:border-lib-border-soft hover:bg-lib-chip'
              }`}
              onClick={() => onChange({ strokeWidth: width })}
            >
              <span
                className="rounded-full bg-current"
                style={{ width: Math.max(width * 2, 4), height: Math.max(width, 2) }}
                aria-hidden
              />
            </button>
          )
        })}
      </div>
      <p className="mb-2 text-[11px] font-semibold tracking-wide text-lib-muted uppercase">
        Color
      </p>
      <div className="grid grid-cols-6 gap-1.5">
        {DRAW_COLOR_SWATCHES.map((hex) => {
          const active = settings.colorHex === hex
          return (
            <button
              key={hex}
              type="button"
              title={hex}
              aria-label={`Color ${hex}`}
              aria-pressed={active}
              className={`size-6 cursor-pointer rounded-full border-2 transition-transform hover:scale-110 ${
                active ? 'border-lib-accent ring-2 ring-lib-accent/30' : 'border-transparent'
              }`}
              style={{ backgroundColor: hex }}
              onClick={() => onChange({ colorHex: hex })}
            />
          )
        })}
      </div>
    </div>
  )
}
