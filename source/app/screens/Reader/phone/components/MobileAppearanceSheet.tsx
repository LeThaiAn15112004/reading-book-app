import type { ReactNode } from 'react'
import type { MessageKey } from '@core'
import type { MarginMode, ReadingPrefs } from '../../components/settings/AaSettingsPanel'
import { useT, useFormat } from '../../../../i18n'
import type { AppThemeMode } from '../../../../theme/appAppearance'
import { useAppAppearanceStore } from '../../../../theme/appAppearanceStore'
import type { ReadingSurface, SurfaceView } from '../logic/readingSurface'
import { MobileReaderIcon } from './MobileReaderIcons'
import { MobileSheet } from './MobileSheet'

const FONT_MIN = 12
const FONT_MAX = 32
const LINE_MIN = 1.3
const LINE_MAX = 2.3
const LINE_STEP = 0.1

const THEMES: { mode: AppThemeMode; label: MessageKey; swatch: string }[] = [
  { mode: 'light', label: 'reader.phone.appearance.paper', swatch: '#f7f4ee' },
  { mode: 'sepia', label: 'reader.phone.appearance.sepia', swatch: '#f1e4c8' },
  { mode: 'dark', label: 'reader.phone.appearance.night', swatch: '#1c1f24' },
  { mode: 'system', label: 'reader.phone.appearance.system', swatch: 'linear-gradient(135deg, #f7f4ee 50%, #1c1f24 50%)' },
]

const FONTS: { id: ReadingPrefs['fontFamily']; label: MessageKey; family: string }[] = [
  { id: 'serif', label: 'reader.phone.appearance.serif', family: 'Georgia, serif' },
  { id: 'sans', label: 'reader.phone.appearance.sans', family: 'system-ui, sans-serif' },
  { id: 'mono', label: 'reader.phone.appearance.mono', family: 'ui-monospace, monospace' },
]

const MARGINS: { id: MarginMode; label: MessageKey }[] = [
  { id: 'off', label: 'reader.phone.appearance.marginsOff' },
  { id: 'narrow', label: 'reader.phone.appearance.narrow' },
  { id: 'normal', label: 'reader.phone.appearance.normal' },
  { id: 'wide', label: 'reader.phone.appearance.wide' },
]

const segment =
  'focus-ring flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-[14px] font-semibold'
const segmentOn = 'bg-lib-surface text-lib-text-strong shadow-sm'
const segmentOff = 'text-lib-muted'
const stepButton =
  'focus-ring flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-lib-border text-lib-text-strong active:bg-lib-hint disabled:opacity-40'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-[12px] font-bold tracking-wide text-lib-faint uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { id: T; text: string; extra?: ReactNode; style?: React.CSSProperties }[]
  onChange: (id: T) => void
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-lib-hint p-1" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className={`${segment} ${value === option.id ? segmentOn : segmentOff}`}
          style={option.style}
        >
          {option.extra}
          {option.text}
        </button>
      ))}
    </div>
  )
}

/**
 * The phone Appearance panel (spec 019, FR-013 / FR-013a / FR-014, Story 4): only what takes effect in the open
 * format — theme (the app's ONE theme setting, as Settings → Appearance), the view (EPUB / PDF: Page / Scroll, per
 * book), zoom (PDF), and font size, font, line spacing and margins (text formats). No keyboard hints, no 1 / 2-page
 * layout. Every control is at least 48 dp tall; changes apply live behind the sheet, which leaves the page visible.
 */
export function MobileAppearanceSheet({
  surface,
  prefs,
  onChange,
  onClose,
}: {
  surface: ReadingSurface
  prefs: ReadingPrefs
  onChange: (patch: Partial<ReadingPrefs>) => void
  onClose: () => void
}) {
  const t = useT()
  const format = useFormat()
  const themeMode = useAppAppearanceStore((s) => s.themeMode)
  const setThemeMode = useAppAppearanceStore((s) => s.setThemeMode)
  const margin: MarginMode = prefs.marginEnabled ? prefs.margin : 'off'
  const { appearance, zoom } = surface

  return (
    <MobileSheet title={t('reader.phone.sheet.appearance')} onClose={onClose} maxHeight="60%" dim={false}>
      <div className="flex flex-col gap-5 p-4">
        <Section title={t('reader.phone.appearance.theme')}>
          <Segmented
            label={t('reader.phone.appearance.theme')}
            value={themeMode}
            onChange={setThemeMode}
            options={THEMES.map((theme) => ({
              id: theme.mode,
              text: t(theme.label),
              extra: <span aria-hidden className="h-4 w-4 shrink-0 rounded-full border border-black/15" style={{ background: theme.swatch }} />,
            }))}
          />
        </Section>

        {appearance.view && surface.setView ? (
          <Section title={t('reader.phone.appearance.view')}>
            <Segmented<SurfaceView>
              label={t('reader.phone.appearance.view')}
              value={surface.view}
              onChange={surface.setView}
              options={[
                { id: 'page', text: t('reader.phone.appearance.viewPage') },
                { id: 'scroll', text: t('reader.phone.appearance.viewScroll') },
              ]}
            />
          </Section>
        ) : null}

        {appearance.zoom && zoom ? (
          <Section title={t('reader.phone.appearance.zoom')}>
            <div className="flex items-center gap-2">
              <button type="button" className={stepButton} onClick={() => zoom.step(-1)} aria-label={t('reader.phone.appearance.zoomOut')}>
                <MobileReaderIcon name="zoomOut" />
              </button>
              <button type="button" className={`${stepButton} flex-1 gap-2 px-3 text-[14px] font-semibold`} onClick={zoom.fit}>
                <MobileReaderIcon name="fit" size={20} />
                {t('reader.phone.appearance.fitPage')}
              </button>
              <span className="w-14 text-center text-[14px] font-semibold text-lib-text-strong tabular-nums">
                {t('reader.phone.appearance.zoomPercent', { value: zoom.percent })}
              </span>
              <button type="button" className={stepButton} onClick={() => zoom.step(1)} aria-label={t('reader.phone.appearance.zoomIn')}>
                <MobileReaderIcon name="zoomIn" />
              </button>
            </div>
          </Section>
        ) : null}

        {appearance.text ? (
          <>
            <Section title={t('reader.phone.appearance.fontSize')}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={stepButton}
                  disabled={prefs.fontSize <= FONT_MIN}
                  onClick={() => onChange({ fontSize: Math.max(FONT_MIN, prefs.fontSize - 2) })}
                  aria-label={t('reader.phone.appearance.smaller')}
                >
                  <MobileReaderIcon name="minus" />
                </button>
                <span className="flex-1 text-center text-[15px] font-semibold text-lib-text-strong tabular-nums">
                  {t('reader.phone.appearance.sizePx', { size: prefs.fontSize })}
                </span>
                <button
                  type="button"
                  className={stepButton}
                  disabled={prefs.fontSize >= FONT_MAX}
                  onClick={() => onChange({ fontSize: Math.min(FONT_MAX, prefs.fontSize + 2) })}
                  aria-label={t('reader.phone.appearance.larger')}
                >
                  <MobileReaderIcon name="plus" />
                </button>
              </div>
            </Section>

            <Section title={t('reader.phone.appearance.fontFamily')}>
              <Segmented
                label={t('reader.phone.appearance.fontFamily')}
                value={prefs.fontFamily}
                onChange={(fontFamily) => onChange({ fontFamily })}
                options={FONTS.map((font) => ({ id: font.id, text: t(font.label), style: { fontFamily: font.family } }))}
              />
            </Section>

            <Section title={t('reader.phone.appearance.lineSpacing')}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={stepButton}
                  disabled={prefs.lineHeight <= LINE_MIN + 0.001}
                  onClick={() => onChange({ lineHeight: Math.max(LINE_MIN, Math.round((prefs.lineHeight - LINE_STEP) * 100) / 100) })}
                  aria-label={t('reader.phone.appearance.tighter')}
                >
                  <MobileReaderIcon name="minus" />
                </button>
                <span className="flex-1 text-center text-[15px] font-semibold text-lib-text-strong tabular-nums">
                  {format.number(prefs.lineHeight, 2)}
                </span>
                <button
                  type="button"
                  className={stepButton}
                  disabled={prefs.lineHeight >= LINE_MAX - 0.001}
                  onClick={() => onChange({ lineHeight: Math.min(LINE_MAX, Math.round((prefs.lineHeight + LINE_STEP) * 100) / 100) })}
                  aria-label={t('reader.phone.appearance.looser')}
                >
                  <MobileReaderIcon name="plus" />
                </button>
              </div>
            </Section>

            <Section title={t('reader.phone.appearance.margins')}>
              <Segmented
                label={t('reader.phone.appearance.margins')}
                value={margin}
                onChange={(id) => onChange(id === 'off' ? { marginEnabled: false } : { marginEnabled: true, margin: id })}
                options={MARGINS.map((m) => ({ id: m.id, text: t(m.label) }))}
              />
            </Section>
          </>
        ) : null}
      </div>
    </MobileSheet>
  )
}
