import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { PDF_SHAPE_KINDS, PDF_SHAPE_LABELS, PDF_SHAPE_MAX_STROKE, PDF_SHAPE_MIN_STROKE, type PdfShapeKind } from '@reading-book/book-reader-sdk'
import { inkWidthToPoints } from '../../logic/pdfInk/pdfInkPrefsStore'
import { usePdfShapePrefsStore } from '../../logic/pdfShapes/pdfShapePrefsStore'
import { useDismissOnOutsideOrEscape } from '../../logic/highlights/useDismissOnOutsideOrEscape'
import { CommitSlider, InkColorControl } from './InkStyleControls'
import { isInkColorPickerOpen } from './inkColorPickerState'

const KIND_ICONS: Record<PdfShapeKind, ReactNode> = {
  rectangle: <rect x="4" y="6" width="16" height="12" rx="1" />,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6" />,
  line: <path d="M5 19 19 5" />,
  arrow: <path d="M5 19 19 5M10 5h9v9" />,
}

/** The icon of a shape kind (toolbar button and the kind selector). */
export function ShapeKindIcon({ kind, className }: { kind: PdfShapeKind; className?: string }) {
  return (
    <svg className={className ?? 'size-[18px] shrink-0'} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {KIND_ICONS[kind]}
    </svg>
  )
}

type ShapeSettingsPopoverProps = {
  anchorRef: RefObject<HTMLElement | null>
  onClose: (refocus: boolean) => void
}

const sectionLabel = 'text-[11px] font-semibold uppercase tracking-wide text-lib-muted'

/**
 * Shape settings: which shape the tool draws, and the stroke colour / thickness / opacity of the NEXT shape.
 * A saved shape keeps what it was drawn with (change one through its toolbar or the Notes list). Portalled and
 * fixed-positioned like the Freehand settings; opening it does not arm the tool or draw.
 */
export function ShapeSettingsPopover({ anchorRef, onClose }: ShapeSettingsPopoverProps) {
  const popRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const kind = usePdfShapePrefsStore((s) => s.kind)
  const colorHex = usePdfShapePrefsStore((s) => s.colorHex)
  const width = usePdfShapePrefsStore((s) => s.width)
  const opacity = usePdfShapePrefsStore((s) => s.opacity)
  const setKind = usePdfShapePrefsStore((s) => s.setKind)
  const setColor = usePdfShapePrefsStore((s) => s.setColor)
  const setWidth = usePdfShapePrefsStore((s) => s.setWidth)
  const setOpacity = usePdfShapePrefsStore((s) => s.setOpacity)
  const [widthLive, setWidthLive] = useState<number | null>(null)
  const [opacityLive, setOpacityLive] = useState<number | null>(null)

  const onDismiss = useCallback((reason: 'escape' | 'outside') => onClose(reason === 'escape'), [onClose])
  useDismissOnOutsideOrEscape(popRef, onDismiss, { ignoreRef: anchorRef, consumeEscape: true })

  useLayoutEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    const pop = popRef.current
    if (!rect || !pop) return
    setPos({ left: Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)), top: rect.bottom + 8 })
  }, [anchorRef])

  useEffect(() => {
    const dismiss = () => {
      if (!isInkColorPickerOpen()) onClose(false)
    }
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
      aria-label="Shape settings"
      data-pdf-shape-panel=""
      className="fixed z-[120] w-[270px] rounded-xl border border-lib-border bg-lib-surface-strong p-3 shadow-xl backdrop-blur-md"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className={sectionLabel}>Shape</span>
          <div className="grid grid-cols-4 gap-1" role="group" aria-label="Shape type">
            {PDF_SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                data-shape-kind-option={k}
                onClick={() => setKind(k)}
                className="flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border border-transparent px-1 py-1.5 text-[11px] font-semibold text-lib-muted hover:border-lib-accent-ring hover:bg-lib-accent-soft hover:text-lib-text-strong aria-pressed:border-lib-accent aria-pressed:bg-lib-accent-soft aria-pressed:text-lib-accent"
              >
                <ShapeKindIcon kind={k} />
                {PDF_SHAPE_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        <InkColorControl colorHex={colorHex} onColor={setColor} live />

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="shape-thickness" className={sectionLabel}>
              Thickness
            </label>
            <span className="text-[12px] font-semibold text-lib-text-strong">{inkWidthToPoints(widthLive ?? width).toFixed(1)} pt</span>
          </div>
          <CommitSlider id="shape-thickness" min={PDF_SHAPE_MIN_STROKE} max={PDF_SHAPE_MAX_STROKE} step={0.0005} value={width} onCommit={setWidth} onDraft={setWidthLive} />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="shape-opacity" className={sectionLabel}>
              Opacity
            </label>
            <span className="text-[12px] font-semibold text-lib-text-strong">{Math.round((opacityLive ?? opacity) * 100)}%</span>
          </div>
          <CommitSlider id="shape-opacity" min={0.05} max={1} step={0.05} value={opacity} onCommit={setOpacity} onDraft={setOpacityLive} />
        </div>
      </div>
    </div>
  )
}
