import type { PageLayout, PageMode } from '../readerSession'

export type MarginMode = 'narrow' | 'normal' | 'wide' | 'off'

/** Per-document / session reading controls (Aa panel). Global theme/font/align live in App Settings. */
export type ReadingPrefs = {
  fontSize: number
  lineHeight: number
  margin: MarginMode
  marginEnabled: boolean
  layout: PageLayout
  pageMode: PageMode
}

type AaSettingsPanelProps = {
  open: boolean
  prefs: ReadingPrefs
  onClose: () => void
  onChange: (patch: Partial<ReadingPrefs>) => void
}

const sectionTitle =
  'mb-2 text-[11px] font-bold tracking-wide text-lib-faint uppercase'
const toggleGroup = 'flex gap-1 rounded-lg bg-lib-hint p-1'
const toggleItem =
  'h-9 flex-1 cursor-pointer rounded-md border-none text-xs font-semibold transition-colors'
const toggleActive = 'bg-lib-bg-mid text-lib-accent'
const toggleIdle = 'bg-transparent text-lib-muted hover:text-lib-text-strong'

export function AaSettingsPanel({
  open,
  prefs,
  onClose,
  onChange,
}: AaSettingsPanelProps) {
  const effectiveMargin = prefs.marginEnabled ? prefs.margin : 'off'

  return (
    <>
      <div
        className={`fixed inset-0 z-[90] bg-lib-bg-deep/60 backdrop-blur-sm transition-opacity ${
          open
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        className={`app-scroll fixed right-0 bottom-0 left-0 z-[95] max-h-[min(88dvh,740px)] overflow-y-auto border-t border-lib-border bg-lib-surface-strong px-5 pt-3 pb-6 shadow-xl backdrop-blur-xl transition-all duration-300 sm:top-[calc(var(--app-titlebar-h,36px)+72px)] sm:right-4 sm:bottom-auto sm:left-auto sm:w-[380px] sm:max-h-[min(78vh,660px)] sm:rounded-xl sm:border ${
          open
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-4 opacity-0 sm:translate-y-2.5'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-lib-border sm:hidden" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="m-0 text-base font-semibold text-lib-text-strong">
            Reading settings
          </h2>
          <button
            className="inline-flex size-9 cursor-pointer items-center justify-center border-none bg-transparent text-lib-muted hover:text-lib-text-strong"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <p className="mb-5 mt-0 text-[12px] leading-snug text-lib-faint">
          Theme, font, and text align are in App Settings and apply to every
          document.
        </p>

        <div className="mb-5">
          <div className={sectionTitle}>Layout</div>
          <div className={toggleGroup}>
            {(
              [
                ['single', '1 page'],
                ['dual', '2 pages'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={`${toggleItem} ${prefs.layout === id ? toggleActive : toggleIdle}`}
                type="button"
                onClick={() => onChange({ layout: id })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 mb-0 text-[11px] leading-snug text-lib-faint">
            2 pages shows a center gutter. The first spine page (cover or
            chapter) is always included.
          </p>
        </div>

        <div className="mb-5">
          <div className={sectionTitle}>Font size / zoom</div>
          <div className="flex items-center gap-2">
            <button
              className="h-10 flex-1 cursor-pointer rounded-lg border border-lib-border bg-lib-bg-mid/50 text-sm font-bold text-lib-text-strong"
              type="button"
              onClick={() =>
                onChange({ fontSize: Math.max(12, prefs.fontSize - 2) })
              }
            >
              A−
            </button>
            <div className="w-14 text-center text-sm font-bold text-lib-text-strong">
              {prefs.fontSize}px
            </div>
            <button
              className="h-10 flex-1 cursor-pointer rounded-lg border border-lib-border bg-lib-bg-mid/50 text-sm font-bold text-lib-text-strong"
              type="button"
              onClick={() =>
                onChange({ fontSize: Math.min(32, prefs.fontSize + 2) })
              }
            >
              A+
            </button>
          </div>
          <p className="mt-2 mb-0 text-[11px] leading-snug text-lib-faint">
            Also on the footer (− / +) or Ctrl/Cmd − + 0.
          </p>
        </div>

        <div className="mb-5">
          <div className={sectionTitle}>Margins</div>
          <div className={`${toggleGroup} mb-2.5`}>
            <button
              className={`${toggleItem} ${prefs.marginEnabled ? toggleActive : toggleIdle}`}
              type="button"
              onClick={() => onChange({ marginEnabled: true })}
            >
              On
            </button>
            <button
              className={`${toggleItem} ${!prefs.marginEnabled ? toggleActive : toggleIdle}`}
              type="button"
              onClick={() => onChange({ marginEnabled: false })}
            >
              Off
            </button>
          </div>
          {prefs.marginEnabled ? (
            <div className={toggleGroup}>
              {(
                [
                  ['narrow', 'Narrow'],
                  ['normal', 'Normal'],
                  ['wide', 'Wide'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={`${toggleItem} ${effectiveMargin === id ? toggleActive : toggleIdle}`}
                  type="button"
                  onClick={() => onChange({ margin: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mb-5">
          <div className={sectionTitle}>Line height</div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1.3}
              max={2.3}
              step={0.05}
              value={prefs.lineHeight}
              className="flex-1 accent-lib-accent"
              onChange={(e) =>
                onChange({ lineHeight: Number(e.target.value) })
              }
            />
            <span className="min-w-8 text-right text-xs font-bold text-lib-text-strong">
              {prefs.lineHeight.toFixed(2)}
            </span>
          </div>
        </div>

        <div>
          <div className={sectionTitle}>Page turn</div>
          <div className={toggleGroup}>
            <button
              className={`${toggleItem} ${prefs.pageMode === 'scroll' ? toggleActive : toggleIdle}`}
              type="button"
              onClick={() => onChange({ pageMode: 'scroll' })}
            >
              Scroll
            </button>
            <button
              className={`${toggleItem} ${prefs.pageMode === 'paginated' ? toggleActive : toggleIdle}`}
              type="button"
              onClick={() => onChange({ pageMode: 'paginated' })}
            >
              Paginated
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
