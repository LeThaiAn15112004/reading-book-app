import type { PageLayout, PageMode, TextAlign } from '../readerSession'

export type ReaderTheme = 'dark' | 'sepia' | 'paper'
export type FontFamily = 'serif' | 'sans' | 'mono'
export type MarginMode = 'narrow' | 'normal' | 'wide' | 'off'

export type ReadingPrefs = {
  theme: ReaderTheme
  fontSize: number
  fontFamily: FontFamily
  fontWeight: 300 | 400 | 600
  lineHeight: number
  margin: MarginMode
  marginEnabled: boolean
  layout: PageLayout
  pageMode: PageMode
  textAlign: TextAlign
}

type AaSettingsPanelProps = {
  open: boolean
  prefs: ReadingPrefs
  onClose: () => void
  onChange: (patch: Partial<ReadingPrefs>) => void
}

const FONT_STACK: Record<FontFamily, string> = {
  serif: '"Literata", Georgia, serif',
  sans: '"Source Sans 3", system-ui, sans-serif',
  mono: 'ui-monospace, Consolas, monospace',
}

export function fontFamilyCss(family: FontFamily): string {
  return FONT_STACK[family]
}

const sectionTitle =
  'mb-2 text-[11px] font-bold tracking-wide text-slate-500 uppercase'
const toggleGroup = 'flex gap-1 rounded-lg bg-slate-950/40 p-1'
const toggleItem =
  'h-9 flex-1 cursor-pointer rounded-md border-none text-xs font-semibold transition-colors'
const toggleActive = 'bg-slate-800 text-amber-400'
const toggleIdle = 'bg-transparent text-slate-400 hover:text-slate-200'

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
        className={`fixed inset-0 z-[90] bg-slate-950/60 backdrop-blur-sm transition-opacity ${
          open
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        className={`app-scroll fixed right-0 bottom-0 left-0 z-[95] max-h-[min(88dvh,740px)] overflow-y-auto border-t border-slate-600/45 bg-slate-900/95 px-5 pt-3 pb-6 shadow-xl backdrop-blur-xl transition-all duration-300 sm:top-[calc(var(--app-titlebar-h,36px)+72px)] sm:right-4 sm:bottom-auto sm:left-auto sm:w-[380px] sm:max-h-[min(78vh,660px)] sm:rounded-xl sm:border ${
          open
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-4 opacity-0 sm:translate-y-2.5'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-600 sm:hidden" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="m-0 text-base font-semibold text-slate-100">
            Reading settings
          </h2>
          <button
            className="inline-flex size-9 cursor-pointer items-center justify-center border-none bg-transparent text-slate-400 hover:text-slate-100"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

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
          <p className="mt-2 mb-0 text-[11px] leading-snug text-slate-500">
            Dual page applies when the window is at least ~900px wide.
          </p>
        </div>

        <div className="mb-5">
          <div className={sectionTitle}>Theme</div>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'dark', label: 'Night', bg: '#0f172a', fg: '#cbd5e1' },
                { id: 'sepia', label: 'Sepia', bg: '#251f19', fg: '#e1cfb3' },
                { id: 'paper', label: 'Paper', bg: '#ffffff', fg: '#334155' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                className={`h-[42px] cursor-pointer rounded-lg border text-[13px] font-semibold ${
                  prefs.theme === t.id
                    ? 'border-amber-500 ring-2 ring-amber-500/30'
                    : 'border-slate-600/40'
                }`}
                type="button"
                style={{ background: t.bg, color: t.fg }}
                onClick={() => onChange({ theme: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <div className={sectionTitle}>Font size</div>
          <div className="flex items-center gap-2">
            <button
              className="h-10 flex-1 cursor-pointer rounded-lg border border-slate-600/45 bg-slate-800/50 text-sm font-bold text-slate-100"
              type="button"
              onClick={() =>
                onChange({ fontSize: Math.max(12, prefs.fontSize - 2) })
              }
            >
              A−
            </button>
            <div className="w-14 text-center text-sm font-bold text-slate-100">
              {prefs.fontSize}px
            </div>
            <button
              className="h-10 flex-1 cursor-pointer rounded-lg border border-slate-600/45 bg-slate-800/50 text-sm font-bold text-slate-100"
              type="button"
              onClick={() =>
                onChange({ fontSize: Math.min(32, prefs.fontSize + 2) })
              }
            >
              A+
            </button>
          </div>
        </div>

        <div className="mb-5">
          <div className={sectionTitle}>Font</div>
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
          <div className={sectionTitle}>Weight</div>
          <div className={toggleGroup}>
            {(
              [
                [300, 'Light'],
                [400, 'Regular'],
                [600, 'Bold'],
              ] as const
            ).map(([w, label]) => (
              <button
                key={w}
                className={`${toggleItem} ${prefs.fontWeight === w ? toggleActive : toggleIdle}`}
                type="button"
                onClick={() => onChange({ fontWeight: w })}
              >
                {label}
              </button>
            ))}
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
              className="flex-1 accent-amber-500"
              onChange={(e) =>
                onChange({ lineHeight: Number(e.target.value) })
              }
            />
            <span className="min-w-8 text-right text-xs font-bold text-slate-100">
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
