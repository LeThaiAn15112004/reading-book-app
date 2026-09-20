import {
  READER_THEME_PRESETS,
  useGlobalReadingPrefs,
  type FontFamily,
  type FontWeight,
  type ReaderTheme,
  type TextAlign,
} from '../../../../chrome'

const sectionTitle =
  'mb-2 text-[11px] font-bold tracking-wide text-lib-faint uppercase'
const toggleGroup = 'flex gap-1 rounded-lg bg-black/20 p-1'
const toggleItem =
  'h-9 flex-1 cursor-pointer rounded-md border-none text-xs font-semibold transition-colors'
const toggleActive = 'bg-lib-bg-mid text-lib-accent'
const toggleIdle = 'bg-transparent text-lib-muted hover:text-lib-text-strong'

/** App theme plus defaults used by books without SCR-05 overrides. */
export function GlobalReadingAppearance() {
  const { prefs, setPrefs } = useGlobalReadingPrefs()

  return (
    <section className="rounded-xl border border-lib-border-soft bg-lib-surface-strong/60 p-5">
      <h2 className="m-0 mb-1 text-base font-semibold text-lib-text-strong">
        Appearance
      </h2>
      <p className="m-0 mb-5 text-[13px] leading-relaxed text-lib-muted">
        Theme colors the whole app. Reading controls below are defaults for
        books that have not been customized in the Reader.
      </p>

      <div className="mb-5">
        <div className={sectionTitle}>Theme</div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              'night',
              'sepia',
              'paper',
            ] as const
          ).map((id) => {
            const preset = READER_THEME_PRESETS[id]
            return (
            <button
              key={id}
              className={`h-[42px] cursor-pointer rounded-lg border text-[13px] font-semibold ${
                prefs.theme === id
                  ? 'border-lib-accent ring-2 ring-lib-accent-ring'
                  : 'border-lib-border-soft'
              }`}
              type="button"
              style={{
                background: preset.swatchBackground,
                color: preset.color,
              }}
              onClick={() => setPrefs({ theme: id as ReaderTheme })}
            >
              {preset.label}
            </button>
            )
          })}
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
              onClick={() => setPrefs({ fontFamily: id as FontFamily })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5">
        <div className={sectionTitle}>Font size</div>
        <div className="flex items-center gap-2">
          <button
            className="h-9 flex-1 cursor-pointer rounded-md border border-lib-border bg-lib-bg-mid/50 text-sm font-bold text-lib-text-strong"
            type="button"
            onClick={() => setPrefs({ fontSize: Math.max(12, prefs.fontSize - 2) })}
          >
            A−
          </button>
          <span className="w-14 text-center text-sm font-bold text-lib-text-strong">
            {prefs.fontSize}px
          </span>
          <button
            className="h-9 flex-1 cursor-pointer rounded-md border border-lib-border bg-lib-bg-mid/50 text-sm font-bold text-lib-text-strong"
            type="button"
            onClick={() => setPrefs({ fontSize: Math.min(32, prefs.fontSize + 2) })}
          >
            A+
          </button>
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
              onClick={() => setPrefs({ fontWeight: w as FontWeight })}
            >
              {label}
            </button>
          ))}
        </div>
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
            onChange={(event) => setPrefs({ lineHeight: Number(event.target.value) })}
          />
          <span className="min-w-8 text-right text-xs font-bold text-lib-text-strong">
            {prefs.lineHeight.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="mb-5">
        <div className={sectionTitle}>Page defaults</div>
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
              onClick={() => setPrefs({ layout: id })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
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
              onClick={() => setPrefs({ textAlign: id as TextAlign })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
