import {
  useGlobalReadingPrefs,
  type FontFamily,
  type FontWeight,
  type ReaderTheme,
  type TextAlign,
} from '../../../chrome'

const sectionTitle =
  'mb-2 text-[11px] font-bold tracking-wide text-lib-faint uppercase'
const toggleGroup = 'flex gap-1 rounded-lg bg-black/20 p-1'
const toggleItem =
  'h-9 flex-1 cursor-pointer rounded-md border-none text-xs font-semibold transition-colors'
const toggleActive = 'bg-lib-bg-mid text-lib-accent'
const toggleIdle = 'bg-transparent text-lib-muted hover:text-lib-text-strong'

/** App appearance — theme is whole-app chrome; font/align also apply to documents. */
export function GlobalReadingAppearance() {
  const { prefs, setPrefs } = useGlobalReadingPrefs()

  return (
    <section className="rounded-xl border border-lib-border-soft bg-lib-surface-strong/60 p-5">
      <h2 className="m-0 mb-1 text-base font-semibold text-lib-text-strong">
        Appearance
      </h2>
      <p className="m-0 mb-5 text-[13px] leading-relaxed text-lib-muted">
        Theme colors the whole app (Library, Settings, Reader chrome). Font,
        weight, and text align apply to every document.
      </p>

      <div className="mb-5">
        <div className={sectionTitle}>Theme</div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: 'night' as ReaderTheme, label: 'Night', bg: '#0f172a', fg: '#cbd5e1' },
              { id: 'sepia' as ReaderTheme, label: 'Sepia', bg: '#251f19', fg: '#e1cfb3' },
              { id: 'paper' as ReaderTheme, label: 'Paper', bg: '#ffffff', fg: '#334155' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              className={`h-[42px] cursor-pointer rounded-lg border text-[13px] font-semibold ${
                prefs.theme === t.id
                  ? 'border-lib-accent ring-2 ring-lib-accent-ring'
                  : 'border-lib-border-soft'
              }`}
              type="button"
              style={{ background: t.bg, color: t.fg }}
              onClick={() => setPrefs({ theme: t.id })}
            >
              {t.label}
            </button>
          ))}
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
