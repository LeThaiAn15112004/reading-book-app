import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { INK_PEN_PRESETS } from '@reading-book/book-reader-sdk'
import { usePdfInkPrefsStore } from '../../logic/pdfInk/pdfInkPrefsStore'
import { useDismissOnOutsideOrEscape } from '../../logic/highlights/useDismissOnOutsideOrEscape'
import { InkStyleControls } from './InkStyleControls'

type FreehandSettingsPopoverProps = {
  anchorRef: RefObject<HTMLElement | null>
  onClose: (refocus: boolean) => void
}

/**
 * Freehand settings: drawing style (Pen / Pencil / Marker), colour, thickness and opacity of the NEXT stroke,
 * remembered per style. Saved strokes keep what they were drawn with (edit one through the selected-stroke
 * panel). Portalled and fixed-positioned like `ToolGroupMenu`; opening it does not arm the tool or draw.
 */
export function FreehandSettingsPopover({ anchorRef, onClose }: FreehandSettingsPopoverProps) {
  const popRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const tool = usePdfInkPrefsStore((s) => s.tool)
  const settings = usePdfInkPrefsStore((s) => s.styles[s.tool])
  const setTool = usePdfInkPrefsStore((s) => s.setTool)
  const setStyleColor = usePdfInkPrefsStore((s) => s.setStyleColor)
  const setStyleWidth = usePdfInkPrefsStore((s) => s.setStyleWidth)
  const setStyleOpacity = usePdfInkPrefsStore((s) => s.setStyleOpacity)

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
      data-ink-style={tool}
      className="fixed z-[120] w-[270px] rounded-xl border border-lib-border bg-lib-surface-strong p-3 shadow-xl backdrop-blur-md"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <InkStyleControls
        idPrefix="freehand"
        style={tool}
        colorHex={settings.colorHex}
        width={settings.width}
        opacity={settings.opacity}
        onStyle={setTool}
        onColor={(hex) => setStyleColor(tool, hex)}
        onWidth={(w) => setStyleWidth(tool, w)}
        onOpacity={(o) => setStyleOpacity(tool, o)}
      />
      <span className="sr-only">{INK_PEN_PRESETS[tool].label} selected</span>
    </div>
  )
}
