import type { PageLayout, PageMode } from '@reading-book/shared/models'
import type {
  FontFamily,
  FontWeight,
  ReaderTheme,
  TextAlign,
} from '@reading-book/shared/models'
import { READER_THEME_COLORS } from '@reading-book/shared/models'

export type MarginMode = 'narrow' | 'normal' | 'wide' | 'off'

/** Per-document / session reading controls (SCR-05 Aa panel). */
export type ReadingPrefs = {
  fontFamily: FontFamily
  fontSize: number
  fontWeight: FontWeight
  lineHeight: number
  textAlign: TextAlign
  margin: MarginMode
  marginEnabled: boolean
  layout: PageLayout
  pageMode: PageMode
}

type AaSettingsPanelProps = {
  open: boolean
  prefs: ReadingPrefs
  theme: ReaderTheme
  onClose: () => void
  onChange: (patch: Partial<ReadingPrefs>) => void
  onThemeChange: (theme: ReaderTheme) => void
}

const sectionTitle =
  'mb-2 text-[11px] font-bold tracking-wide text-lib-faint uppercase'
const toggleGroup = 'flex gap-1 rounded-lg bg-lib-hint p-1'
const toggleItem =
  'h-9 flex-1 cursor-pointer rounded-md border-none text-xs font-semibold transition-colors'
const toggleActive = 'bg-lib-bg-mid text-lib-accent'
const toggleIdle = 'bg-transparent text-lib-muted hover:text-lib-text-strong'
const themeIds: ReaderTheme[] = ['night', 'sepia', 'paper']

export function AaSettingsPanel({
  open,
  prefs,
  theme,
  onClose,
  onChange,
  onThemeChange,
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

        <div className="mb-5">
          <div className={sectionTitle}>Theme</div>
          <div className="grid grid-cols-3 gap-2">
            {themeIds.map((id) => {
              const preset = READER_THEME_COLORS[id]
              return (
              <button
                key={id}
                className={`h-[42px] cursor-pointer rounded-lg border text-[13px] font-semibold ${
                  theme === id
                    ? 'border-lib-accent ring-2 ring-lib-accent-ring'
                    : 'border-lib-border-soft'
                }`}
                type="button"
                style={{
                  background: preset.swatchBackground,
                  color: preset.color,
                }}
                onClick={() => onThemeChange(id)}
              >
                {preset.label}
              </button>
              )
            })}
          </div>
        </div>

        <div className="mb-5">
          <div className={sectionTitle}>Font family</div>
          <div className={toggleGroup}>
            {(
              [
                ['serif', 'Serif'],
                ['sans', 'Sans'],
                ['mono', 'Mono'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={`${toggleItem} ${prefs.fontFamily === id ? toggleActive : toggleIdle}`}
                type="button"
                onClick={() => onChange({ fontFamily: id })}
              >
                {label}
              </button>
            ))}
          </div>
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
          <div className={sectionTitle}>Font weight</div>
          <div className={toggleGroup}>
            {(
              [
                [300, 'Light'],
                [400, 'Regular'],
                [600, 'Bold'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={`${toggleItem} ${prefs.fontWeight === value ? toggleActive : toggleIdle}`}
                type="button"
                onClick={() => onChange({ fontWeight: value })}
              >
                {label}
              </button>
            ))}
          </div>
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

        <div className="mb-5">
          <div className={sectionTitle}>Text align</div>
          <div className={toggleGroup}>
            {(
              [
                ['left', 'Left'],
                ['justify', 'Justify'],
                ['center', 'Center'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={`${toggleItem} ${prefs.textAlign === id ? toggleActive : toggleIdle}`}
                type="button"
                onClick={() => onChange({ textAlign: id })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

      </div>
    </>
  )
}
