import type { PointerEvent as ReactPointerEvent } from 'react'
import { HIGHLIGHT_COLOR_PRESETS } from '@core'
import { useBackClose } from '../../../../hooks/app/useBackClose'
import { useT } from '../../../../i18n'
import type { SurfaceSelection } from '../logic/readingSurface'
import { MobileReaderIcon } from './MobileReaderIcons'

/** Keeps the native selection alive: a tap on a button must not collapse it before the action reads it. */
const keepSelection = (event: ReactPointerEvent) => event.preventDefault()

const iconButton =
  'focus-ring flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-lib-text-strong active:bg-lib-hint'

/** The swatches: the last used colour first, then the other presets. */
function swatches(lastColorHex: string) {
  const last = HIGHLIGHT_COLOR_PRESETS.find((p) => p.hex.toLowerCase() === lastColorHex.toLowerCase())
  return last ? [last, ...HIGHLIGHT_COLOR_PRESETS.filter((p) => p !== last)] : [...HIGHLIGHT_COLOR_PRESETS]
}

/**
 * The selection bar, ONE step (spec 019, FR-015, SC-006): shown as soon as a selection is finished — colour swatches
 * (a tap marks at once), underline, strike, note, copy. It sits at the bottom, away from the OS selection callout.
 * Back clears the selection (FR-001).
 */
export function MobileSelectionBar({
  selection,
  lastColorHex,
  onCopy,
}: {
  selection: SurfaceSelection
  lastColorHex: string
  onCopy: (text: string) => void
}) {
  const t = useT()
  useBackClose(true, selection.close)
  const colours = swatches(lastColorHex)
  return (
    <div className="fixed inset-x-0 bottom-0 z-[350] px-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
      <div
        role="toolbar"
        aria-label={t('reader.phone.selection.aria')}
        className="mx-auto flex max-w-[560px] items-center gap-0.5 overflow-x-auto rounded-2xl border border-lib-border bg-lib-surface-strong p-1 shadow-2xl"
      >
        {colours.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={iconButton}
            onPointerDown={keepSelection}
            onClick={() => selection.mark('highlight', preset.hex)}
            aria-label={t('reader.phone.selection.color', {
              color: t(`reader.annotations.colors.${preset.id as 'yellow'}`) || preset.label,
            })}
          >
            <span aria-hidden className="block h-6 w-6 rounded-full border border-black/10" style={{ background: preset.hex }} />
          </button>
        ))}
        <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-lib-border" />
        <button
          type="button"
          className={iconButton}
          onPointerDown={keepSelection}
          onClick={() => selection.mark('underline', lastColorHex)}
          aria-label={t('reader.phone.selection.underline')}
        >
          <MobileReaderIcon name="underline" />
        </button>
        <button
          type="button"
          className={iconButton}
          onPointerDown={keepSelection}
          onClick={() => selection.mark('strikethrough', lastColorHex)}
          aria-label={t('reader.phone.selection.strike')}
        >
          <MobileReaderIcon name="strike" />
        </button>
        <button
          type="button"
          className={iconButton}
          onPointerDown={keepSelection}
          onClick={() => selection.note(lastColorHex)}
          aria-label={t('reader.phone.selection.note')}
        >
          <MobileReaderIcon name="note" />
        </button>
        <button
          type="button"
          className={iconButton}
          onPointerDown={keepSelection}
          onClick={() => {
            onCopy(selection.text)
            selection.close()
          }}
          aria-label={t('reader.phone.selection.copy')}
        >
          <MobileReaderIcon name="copy" />
        </button>
        <button type="button" className={`${iconButton} text-lib-muted`} onClick={selection.close} aria-label={t('reader.phone.selection.close')}>
          <MobileReaderIcon name="close" />
        </button>
      </div>
    </div>
  )
}
