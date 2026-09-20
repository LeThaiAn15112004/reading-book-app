import { useState } from 'react'
import { HexAlphaColorPicker, HexColorInput } from 'react-colorful'
import {
  HIGHLIGHT_COLOR_PRESETS,
  splitHighlightColor,
  withHighlightAlpha,
  type HighlightStyleKind,
} from '@reading-book/book-reader-sdk'

type HighlightColorPickerProps = {
  value: string
  styleKind: HighlightStyleKind
  onChange: (colorHex: string) => void
}

/** Matches the fallback opacity `styleAttrsFor` (openEpubjs.ts) paints legacy 6-digit colors
 *  with, so opening the picker on an old row doesn't visually jump before the user touches it. */
const LEGACY_ALPHA: Record<HighlightStyleKind, number> = {
  underline: 0.9,
  strikethrough: 0.9,
  highlight: 0.35,
  textbox: 1,
}

/**
 * Color select row for a highlight/underline: five quick preset swatches (unchanged, full
 * opacity, matching the style kind's historical fixed look) plus a "Custom" swatch that expands
 * a full hue/saturation area + alpha slider + hex input (react-colorful) for anyone who wants a
 * specific shade or transparency. `colorHex` round-trips as plain `#RRGGBB` for a preset pick, or
 * `#RRGGBBAA` once alpha has been touched — see `splitHighlightColor`/`withHighlightAlpha`.
 */
export function HighlightColorPicker({ value, styleKind, onChange }: HighlightColorPickerProps) {
  const [customOpen, setCustomOpen] = useState(false)
  const { hex6, alpha } = splitHighlightColor(value, LEGACY_ALPHA[styleKind])
  const pickerColor = withHighlightAlpha(hex6, alpha)
  const isPreset = HIGHLIGHT_COLOR_PRESETS.some(
    (preset) => preset.hex.toLowerCase() === value.toLowerCase(),
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {HIGHLIGHT_COLOR_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            title={preset.label}
            aria-label={preset.label}
            className="h-6 w-6 shrink-0 cursor-pointer rounded-full"
            style={{
              backgroundColor: preset.hex,
              outline:
                !customOpen && value.toLowerCase() === preset.hex.toLowerCase()
                  ? '2px solid var(--lib-accent, #4FC3F7)'
                  : '1px solid var(--lib-border, #888)',
              outlineOffset: 1,
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setCustomOpen(false)
              onChange(preset.hex)
            }}
          />
        ))}
        <button
          type="button"
          title="Custom color"
          aria-label="Custom color"
          aria-pressed={customOpen}
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-[11px]"
          style={{
            background:
              'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
            outline:
              customOpen || !isPreset
                ? '2px solid var(--lib-accent, #4FC3F7)'
                : '1px solid var(--lib-border, #888)',
            outlineOffset: 1,
          }}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setCustomOpen((v) => !v)
          }}
        />
      </div>

      {customOpen ? (
        <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
          <HexAlphaColorPicker
            color={pickerColor}
            onChange={(next) => onChange(next)}
          />
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="text-[12px] text-lib-muted">
              #
            </span>
            <HexColorInput
              alpha
              color={pickerColor}
              onChange={(next) => onChange(next)}
              className="h-7 w-full rounded-md border border-lib-border bg-lib-bg-mid/50 px-2 text-[12px] text-lib-text"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
