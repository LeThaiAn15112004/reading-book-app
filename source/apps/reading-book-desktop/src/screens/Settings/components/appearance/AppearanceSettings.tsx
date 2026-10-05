import { useState } from 'react'
import { READER_THEME_PRESETS } from '../../../../chrome'
import {
  ACCENT_COLORS,
  APP_LANGUAGES,
  APP_THEME_MODES,
  UI_DENSITIES,
  type AppThemeMode,
  type UiDensity,
} from '../../../../theme/appAppearance'
import { useAppAppearanceStore } from '../../../../theme/appAppearanceStore'
import { SettingsCard } from '../layout/SettingsCard'
import { AccentColorPicker } from './AccentColorPicker'

const THEME_LABELS: Record<AppThemeMode, { label: string; hint: string }> = {
  light: { label: 'Light', hint: 'Bright surfaces' },
  dark: { label: 'Dark', hint: 'Default' },
  sepia: { label: 'Sepia', hint: 'Warm, low glare' },
  system: { label: 'System', hint: 'Follow the OS' },
}

const DENSITY_LABELS: Record<UiDensity, { label: string; hint: string }> = {
  comfortable: { label: 'Comfortable', hint: 'More spacing' },
  balanced: { label: 'Balanced', hint: 'Default' },
  compact: { label: 'Compact', hint: 'More content on screen' },
}

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent'

function CheckIcon({ className = 'size-3' }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={3}
      stroke="currentColor"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  )
}

/** Miniature window preview in the theme's own colors. */
function ThemePreview({ mode }: { mode: AppThemeMode }) {
  if (mode === 'system') {
    return (
      <div className="flex h-16 overflow-hidden rounded-md border border-lib-border-soft">
        <div className="flex-1" style={{ background: READER_THEME_PRESETS.paper.swatchBackground }}>
          <PreviewLines color={READER_THEME_PRESETS.paper.color} />
        </div>
        <div className="flex-1" style={{ background: READER_THEME_PRESETS.night.swatchBackground }}>
          <PreviewLines color={READER_THEME_PRESETS.night.color} />
        </div>
      </div>
    )
  }
  const preset =
    READER_THEME_PRESETS[mode === 'light' ? 'paper' : mode === 'dark' ? 'night' : 'sepia']
  return (
    <div
      className="h-16 overflow-hidden rounded-md border border-lib-border-soft"
      style={{ background: preset.swatchBackground }}
    >
      <PreviewLines color={preset.color} />
    </div>
  )
}

function PreviewLines({ color }: { color: string }) {
  return (
    <div className="flex flex-col gap-1.5 p-2.5" aria-hidden>
      <span className="h-1.5 w-3/5 rounded-full opacity-90" style={{ background: color }} />
      <span className="h-1 w-4/5 rounded-full opacity-45" style={{ background: color }} />
      <span className="h-1 w-2/3 rounded-full opacity-45" style={{ background: color }} />
    </div>
  )
}

/**
 * SCR-06 Settings → Appearance: global app theme, accent color and UI density.
 * App-wide only — per-book reading settings stay in the Reader.
 */
export function AppearanceSettings() {
  const themeMode = useAppAppearanceStore((s) => s.themeMode)
  const accent = useAppAppearanceStore((s) => s.accent)
  const density = useAppAppearanceStore((s) => s.density)
  const setThemeMode = useAppAppearanceStore((s) => s.setThemeMode)
  const setAccent = useAppAppearanceStore((s) => s.setAccent)
  const setDensity = useAppAppearanceStore((s) => s.setDensity)
  const language = useAppAppearanceStore((s) => s.language)
  const setLanguage = useAppAppearanceStore((s) => s.setLanguage)
  const customAccent = useAppAppearanceStore((s) => s.customAccent)
  const setCustomAccent = useAppAppearanceStore((s) => s.setCustomAccent)
  const [customPickerOpen, setCustomPickerOpen] = useState(false)
  const customSelected = accent === 'custom'

  return (
    <div className="@container flex flex-col gap-[var(--ui-density-gap)]">
      <SettingsCard
        title="App Theme"
        description="Colors the whole app, including the reading page. System follows your OS light/dark setting."
      >
        <div
          className="grid grid-cols-2 gap-3 @xl:grid-cols-4"
          role="radiogroup"
          aria-label="App theme"
        >
          {APP_THEME_MODES.map((mode) => {
            const selected = themeMode === mode
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`relative flex cursor-pointer flex-col gap-2 rounded-lg border bg-lib-bg-mid/40 p-2 text-left transition-colors ${focusRing} ${
                  selected
                    ? 'border-lib-accent ring-2 ring-lib-accent-ring'
                    : 'border-lib-border-soft hover:border-lib-border'
                }`}
                onClick={() => setThemeMode(mode)}
              >
                <ThemePreview mode={mode} />
                <span className="flex items-center justify-between gap-2 px-0.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-lib-text-strong">
                      {THEME_LABELS[mode].label}
                    </span>
                    <span className="block truncate text-[11px] text-lib-faint">
                      {THEME_LABELS[mode].hint}
                    </span>
                  </span>
                  <span
                    className={`inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border ${
                      selected
                        ? 'border-lib-accent bg-lib-accent text-lib-bg-deep'
                        : 'border-lib-border bg-transparent text-transparent'
                    }`}
                    aria-hidden
                  >
                    <CheckIcon />
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Accent Color"
        description="Used for buttons, selections and highlights across the app."
      >
        <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Accent color">
          {ACCENT_COLORS.map((color) => {
            const selected = accent === color.id
            return (
              <button
                key={color.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={color.label}
                title={color.label}
                className={`flex w-16 cursor-pointer flex-col items-center gap-1.5 rounded-lg border-none bg-transparent p-1 ${focusRing}`}
                onClick={() => setAccent(color.id)}
              >
                <span
                  className={`inline-flex size-9 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-lib-bg-deep transition-shadow ${
                    selected ? 'ring-2 ring-lib-text-strong' : 'ring-0'
                  }`}
                  style={{ background: color.swatch }}
                  aria-hidden
                >
                  {selected ? <CheckIcon className="size-4 drop-shadow" /> : null}
                </span>
                <span
                  className={`text-[11px] font-medium ${
                    selected ? 'text-lib-text-strong' : 'text-lib-muted'
                  }`}
                >
                  {color.label}
                </span>
              </button>
            )
          })}
          <div className="relative">
            <button
              type="button"
              role="radio"
              aria-checked={customSelected}
              aria-haspopup="dialog"
              aria-expanded={customPickerOpen}
              aria-label={`Custom color ${customAccent.toUpperCase()}`}
              title={`Custom (${customAccent.toUpperCase()})`}
              className={`flex w-16 cursor-pointer flex-col items-center gap-1.5 rounded-lg border-none bg-transparent p-1 ${focusRing}`}
              onClick={() => setCustomPickerOpen((open) => !open)}
            >
              <span
                className={`inline-flex size-9 items-center justify-center rounded-full ring-offset-2 ring-offset-lib-bg-deep transition-shadow ${
                  customSelected ? 'ring-2 ring-lib-text-strong' : 'ring-0'
                }`}
                style={{
                  background: customSelected
                    ? customAccent
                    : 'conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)',
                  color: customSelected ? 'var(--lib-on-accent)' : '#fff',
                }}
                aria-hidden
              >
                {customSelected ? (
                  <CheckIcon className="size-4 drop-shadow" />
                ) : (
                  <span className="inline-flex size-4 items-center justify-center rounded-full bg-black/35 text-[13px] leading-none font-semibold">
                    +
                  </span>
                )}
              </span>
              <span
                className={`text-[11px] font-medium ${
                  customSelected ? 'text-lib-text-strong' : 'text-lib-muted'
                }`}
              >
                Custom
              </span>
            </button>
            {customPickerOpen ? (
              <AccentColorPicker
                value={customAccent}
                onCancel={() => setCustomPickerOpen(false)}
                onApply={(hex) => {
                  setCustomAccent(hex)
                  setCustomPickerOpen(false)
                }}
              />
            ) : null}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="UI Density"
        description="Spacing of app chrome. Applied to Settings now; other screens adopt it later."
      >
        <div
          className="grid grid-cols-1 gap-2 @lg:grid-cols-3"
          role="radiogroup"
          aria-label="UI density"
        >
          {UI_DENSITIES.map((id) => {
            const selected = density === id
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${focusRing} ${
                  selected
                    ? 'border-lib-accent bg-lib-accent-soft'
                    : 'border-lib-border-soft bg-transparent hover:border-lib-border'
                }`}
                onClick={() => setDensity(id)}
              >
                <DensityGlyph density={id} selected={selected} />
                <span className="min-w-0">
                  <span
                    className={`block text-[13px] font-semibold ${
                      selected ? 'text-lib-accent' : 'text-lib-text-strong'
                    }`}
                  >
                    {DENSITY_LABELS[id].label}
                  </span>
                  <span className="block text-[11px] text-lib-faint">
                    {DENSITY_LABELS[id].hint}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Language"
        description="Language of the app interface (menus, Settings, Library, dialogs). Book content is not changed; translation languages are chosen in the Reader's Translate panel."
      >
        <div className="flex flex-col gap-2">
          <span id="app-language-label" className="text-[12px] font-semibold text-lib-text-strong">
            App Language
          </span>
          <div
            className="grid grid-cols-1 gap-2 @lg:grid-cols-3"
            role="radiogroup"
            aria-labelledby="app-language-label"
          >
            {APP_LANGUAGES.map((option) => {
              const selected = language === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  lang={option.id === 'system' ? undefined : option.id}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${focusRing} ${
                    selected
                      ? 'border-lib-accent bg-lib-accent-soft'
                      : 'border-lib-border-soft bg-transparent hover:border-lib-border'
                  }`}
                  onClick={() => setLanguage(option.id)}
                >
                  <span
                    className={`text-[13px] font-semibold ${
                      selected ? 'text-lib-accent' : 'text-lib-text-strong'
                    }`}
                  >
                    {option.label}
                  </span>
                  <span
                    className={`inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border ${
                      selected
                        ? 'border-lib-accent bg-lib-accent text-lib-bg-deep'
                        : 'border-lib-border bg-transparent text-transparent'
                    }`}
                    aria-hidden
                  >
                    <CheckIcon />
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}

/** Three bars whose spacing hints at the density. */
function DensityGlyph({ density, selected }: { density: UiDensity; selected: boolean }) {
  const gap = density === 'comfortable' ? 'gap-[5px]' : density === 'balanced' ? 'gap-[3px]' : 'gap-[1.5px]'
  return (
    <span className={`flex w-6 shrink-0 flex-col ${gap}`} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`h-[3px] rounded-full ${selected ? 'bg-lib-accent' : 'bg-lib-muted'}`}
        />
      ))}
    </span>
  )
}
