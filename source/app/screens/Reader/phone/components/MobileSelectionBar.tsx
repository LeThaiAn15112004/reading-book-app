import type { PointerEvent as ReactPointerEvent } from 'react'
import { useT } from '../../../../i18n'

export type SelectionMarkKind = 'highlight' | 'underline' | 'strikethrough' | 'textbox'

/** Keeps the native selection alive: a tap on a button must not collapse it before the action reads it. */
const keepSelection = (event: ReactPointerEvent) => event.preventDefault()

const button =
  'min-h-[44px] min-w-[44px] flex-1 rounded-lg px-2 text-[13px] font-semibold text-lib-text-strong active:bg-lib-hint'

/**
 * The action bar for selected text (spec 008, T103; `contracts/phone-ui.md`, Layout). It sits at the bottom, above the
 * safe area, so it never covers the OS selection callout, which Android and iOS draw next to the selection.
 *
 * Two states: `pending` (a native selection exists, the renderer has not reported it yet: one "Mark" button asks it,
 * see `useLiveSelection`) and `ready` (the renderer's selection menu is open: the marking actions).
 */
export function MobileSelectionBar({
  state,
  colorHex,
  onRequest,
  onMark,
  onCopy,
  onDismiss,
}: {
  state: 'pending' | 'ready'
  colorHex: string
  onRequest: () => void
  onMark: (kind: SelectionMarkKind) => void
  onCopy: () => void
  onDismiss: () => void
}) {
  const t = useT()
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[350] px-3"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
    >
      <div
        role="toolbar"
        aria-label={t('reader.phone.selection.aria')}
        className="mx-auto flex max-w-[520px] items-center gap-1 rounded-2xl border border-lib-border bg-lib-surface-strong p-1.5 shadow-2xl"
      >
        {state === 'pending' ? (
          <button type="button" className={button} onPointerDown={keepSelection} onClick={onRequest}>
            <span aria-hidden className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: colorHex }} />
            {t('reader.phone.selection.mark')}
          </button>
        ) : (
          <>
            <button type="button" className={button} onPointerDown={keepSelection} onClick={() => onMark('highlight')}>
              <span aria-hidden className="mr-1.5 inline-block h-3 w-3 rounded-full align-middle" style={{ background: colorHex }} />
              {t('reader.annotations.selection.highlight')}
            </button>
            <button type="button" className={button} onPointerDown={keepSelection} onClick={() => onMark('underline')}>
              {t('reader.annotations.selection.underline')}
            </button>
            <button type="button" className={button} onPointerDown={keepSelection} onClick={() => onMark('textbox')}>
              {t('reader.phone.mark.note')}
            </button>
            <button type="button" className={button} onPointerDown={keepSelection} onClick={onCopy}>
              {t('reader.annotations.selection.copy')}
            </button>
          </>
        )}
        <button type="button" aria-label={t('common.actions.cancel')} className="min-h-[44px] min-w-[44px] rounded-lg text-[18px] text-lib-muted" onClick={onDismiss}>
          ×
        </button>
      </div>
    </div>
  )
}
