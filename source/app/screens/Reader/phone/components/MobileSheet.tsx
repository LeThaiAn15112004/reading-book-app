import type { ReactNode } from 'react'
import { useBackClose } from '../../../../hooks/app/useBackClose'
import { useT } from '../../../../i18n'
import { MobileReaderIcon } from './MobileReaderIcons'

/**
 * A bottom sheet over the page (spec 008, T103; spec 019 FR-001). Tapping the dimmed page or pressing Android Back
 * closes it (one `useBackClose` entry per open sheet, so Back closes the innermost layer first). It never covers more
 * than `maxHeight` of the screen, so the page stays visible, and keeps clear of the home indicator.
 */
export function MobileSheet({
  title,
  onClose,
  children,
  actions,
  maxHeight = '75%',
  dim = true,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  /** Buttons in the sheet's header, left of Close. */
  actions?: ReactNode
  maxHeight?: string
  /** Dim the page behind (Appearance does not: its changes show live behind it). */
  dim?: boolean
}) {
  const t = useT()
  useBackClose(true, onClose)
  return (
    <div className="fixed inset-0 z-[400] flex flex-col justify-end" role="presentation">
      <button
        type="button"
        aria-label={t('reader.phone.sheet.close')}
        className={`absolute inset-0 ${dim ? 'bg-black/40' : 'bg-transparent'}`}
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="phone-reader-sheet relative flex flex-col rounded-t-2xl border-t border-lib-border bg-lib-surface-strong text-lib-text shadow-2xl"
        style={{ paddingBottom: 'var(--app-safe-bottom, env(safe-area-inset-bottom))', maxHeight }}
      >
        <header className="flex min-h-[52px] items-center gap-2 border-b border-lib-border pr-1 pl-4">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-lib-text-strong">{title}</h2>
          {actions}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('reader.phone.sheet.close')}
            className="focus-ring flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-lib-muted active:bg-lib-hint"
          >
            <MobileReaderIcon name="close" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </section>
    </div>
  )
}

/** One full-width row of a sheet list: at least 48 px high. */
export function MobileSheetRow({
  children,
  onSelect,
  active = false,
  indent = 0,
  trailing,
}: {
  children: ReactNode
  onSelect: () => void
  active?: boolean
  indent?: number
  trailing?: ReactNode
}) {
  return (
    <div className={`flex min-h-[48px] items-center border-b border-lib-border/60 ${active ? 'bg-lib-hint' : ''}`}>
      <button
        type="button"
        onClick={onSelect}
        className="focus-ring min-h-[48px] min-w-0 flex-1 py-2 pr-2 text-left text-[14px] text-lib-text active:bg-lib-hint"
        style={{ paddingLeft: 16 + indent * 16 }}
        aria-current={active || undefined}
      >
        {children}
      </button>
      {trailing}
    </div>
  )
}
