import type { ReactNode } from 'react'

/**
 * A bottom sheet over the page (spec 008, T103; `contracts/phone-ui.md`, Layout: "each panel is a bottom sheet over the
 * page, never a docked sidebar"). Tapping the dimmed page closes it. The sheet never covers more than 75 % of the
 * height, so the page stays visible, and it keeps clear of the home indicator through the safe-area inset.
 */
export function MobileSheet({
  title,
  onClose,
  children,
  actions,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  /** Buttons in the sheet's header, left of Close. */
  actions?: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[400] flex flex-col justify-end" role="presentation">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[75%] flex-col rounded-t-2xl border-t border-lib-border bg-lib-surface-strong text-lib-text shadow-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <header className="flex min-h-[52px] items-center gap-2 border-b border-lib-border px-4">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-lib-text-strong">{title}</h2>
          {actions}
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-lg px-2 text-[14px] font-semibold text-lib-muted"
          >
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </section>
    </div>
  )
}

/** One full-width row of a sheet list: at least 44 px high. */
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
        className="min-h-[48px] min-w-0 flex-1 py-2 pr-2 text-left text-[14px] text-lib-text"
        style={{ paddingLeft: 16 + indent * 16 }}
        aria-current={active || undefined}
      >
        {children}
      </button>
      {trailing}
    </div>
  )
}
