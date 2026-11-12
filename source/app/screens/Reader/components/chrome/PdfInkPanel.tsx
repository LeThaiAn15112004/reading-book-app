import type { InkPenStyle } from '@core'
import type { PdfInkMark } from '../../logic/pdfInk/pdfInkStore'
import { InkStyleControls } from './InkStyleControls'
import { useT } from '../../../../i18n'

type PdfInkPanelProps = {
  /** The selected stroke as saved. */
  stroke: PdfInkMark
  /** Change the look of THIS stroke only (one undo step each); the Freehand tool settings are untouched. */
  onChange: (patch: Partial<Pick<PdfInkMark, 'penStyle' | 'colorHex' | 'width' | 'opacity'>>) => void
  onDeleteSelected: () => void
}

/**
 * The selected stroke: edit its style / colour / thickness / opacity, or delete it (also the Delete key).
 * Edits apply to this stroke alone — the settings in the toolbar's Freehand menu (the NEXT stroke) never
 * change here, and changing them never reaches a saved stroke.
 */
export function PdfInkPanel({ stroke, onChange, onDeleteSelected }: PdfInkPanelProps) {
  const t = useT()
  return (
    <div
      role="dialog"
      aria-label={t('reader.chrome.ink.selectedStroke')}
      data-pdf-ink-panel="selected"
      data-ink-style={stroke.penStyle}
      className="fixed bottom-14 right-4 z-[120] flex w-[270px] flex-col gap-3 rounded-xl border border-lib-border bg-lib-surface-strong p-3 shadow-xl backdrop-blur-md"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-lib-text-strong">{t('reader.chrome.ink.selectedStroke')}</span>
        <button
          type="button"
          onClick={onDeleteSelected}
          className="cursor-pointer rounded-md px-2 py-1 text-[13px] font-semibold text-lib-text-strong hover:bg-lib-accent-soft"
        >
          {t('reader.chrome.ink.deleteStroke')}
        </button>
      </div>
      <InkStyleControls
        idPrefix="stroke"
        style={stroke.penStyle}
        colorHex={stroke.colorHex}
        width={stroke.width}
        opacity={stroke.opacity}
        onStyle={(penStyle: InkPenStyle) => onChange({ penStyle })}
        onColor={(colorHex) => onChange({ colorHex })}
        onWidth={(width) => onChange({ width })}
        onOpacity={(opacity) => onChange({ opacity })}
      />
    </div>
  )
}
