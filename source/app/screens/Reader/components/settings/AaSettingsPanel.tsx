import type { PageLayout } from '@reading-book/book-reader-sdk'
import { useShortcutLabel } from '../../../../shortcuts/useShortcutLabel'
import type {
  FontFamily,
  FontWeight,
  ReadingViewMode,
  TextAlign,
} from '@reading-book/book-reader-sdk'

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
  viewMode: ReadingViewMode
}

type AaSettingsPanelProps = {
  prefs: ReadingPrefs
  onChange: (patch: Partial<ReadingPrefs>) => void
}

const sectionTitle =
  'mb-2 text-[11px] font-bold tracking-wide text-lib-faint uppercase'
const toggleGroup = 'flex gap-1 rounded-lg bg-lib-hint p-1'
const toggleItem =
  'h-9 flex-1 cursor-pointer rounded-md border-none text-xs font-semibold transition-colors'
const toggleActive = 'bg-lib-bg-mid text-lib-accent'
const toggleIdle = 'bg-transparent text-lib-muted hover:text-lib-text-strong'

/**
 * Per-book reading settings (SCR-05 Aa) — body only. The app theme (Night/Sepia/Paper) is a
 * global preference and lives in the app Settings screen, not here; `ReaderScreen` hosts it in the docked
 * `ReaderRightSidebar`, which owns the title, close button and scrolling.
 */
export function AaSettingsPanel({
  prefs,
  onChange,
}: AaSettingsPanelProps) {
  const zoomIn = useShortcutLabel('view.zoomIn')
  const zoomOut = useShortcutLabel('view.zoomOut')
  const resetZoom = useShortcutLabel('view.resetZoom')
  const effectiveMargin = prefs.marginEnabled ? prefs.margin : 'off'

  return (
    <div>
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
          Also on the footer (− / +) or {zoomOut} / {zoomIn} / {resetZoom}.
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
        <div className={sectionTitle}>Chế độ xem</div>
        <div className={toggleGroup}>
          <button
            className={`${toggleItem} ${prefs.viewMode !== 'scroll' ? toggleActive : toggleIdle}`}
            type="button"
            onClick={() => onChange({ viewMode: 'paginated' })}
          >
            Lật trang
          </button>
          <button
            className={`${toggleItem} ${prefs.viewMode === 'scroll' ? toggleActive : toggleIdle}`}
            type="button"
            onClick={() => onChange({ viewMode: 'scroll' })}
          >
            Cuộn dọc
          </button>
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
  )
}
