/**
 * Format controls of a Typewriter note (specs/005-typewriter-note, US3): family, size (pt on a nominal 612 pt page),
 * colour (picker + HEX), B / I / U / S and alignment. Pure view: the host passes the effective values and applies the
 * change (to an editor range, a caret, or the whole box). Buttons cancel `mousedown` so the editor keeps its
 * selection; the size and HEX inputs take focus, and the model keeps the selection meanwhile.
 */
import { useEffect, useState, type MouseEvent } from 'react'
import { HexColorPicker } from 'react-colorful'
import { parseHexInput } from '../../logic/pdfTypewriter/typewriterFormatValues'
import {
  TYPEWRITER_ALIGNS,
  TYPEWRITER_MAX_SIZE,
  TYPEWRITER_MIN_SIZE,
  familyHasItalic,
  typewriterFamilies,
  type TypewriterAlign,
  type TypewriterFamilyId,
  type TypewriterTextStyle,
} from '@reading-book/book-reader-sdk'

const PAGE_PT = 612
const keepFocus = (e: MouseEvent) => e.preventDefault()
type FlagKey = 'bold' | 'italic' | 'underline' | 'strike'

export type TypewriterFormatValues = {
  style: TypewriterTextStyle
  /** Keys whose value differs across the selection (shown as indeterminate). */
  mixed: ReadonlySet<keyof TypewriterTextStyle>
  align: TypewriterAlign | 'mixed'
}

type Props = {
  values: TypewriterFormatValues
  onStyle: (patch: Partial<TypewriterTextStyle>) => void
  onAlign: (align: TypewriterAlign) => void
}

const FLAGS: { key: FlagKey; label: string; title: string; css: string }[] = [
  { key: 'bold', label: 'B', title: 'Bold (Ctrl+B)', css: 'font-bold' },
  { key: 'italic', label: 'I', title: 'Italic (Ctrl+I)', css: 'italic' },
  { key: 'underline', label: 'U', title: 'Underline (Ctrl+U)', css: 'underline' },
  { key: 'strike', label: 'S', title: 'Strikethrough (Ctrl+Shift+X)', css: 'line-through' },
]
const ALIGN_LABEL: Record<TypewriterAlign, string> = { left: 'Left', center: 'Center', right: 'Right', justify: 'Justify' }
const ALIGN_GLYPH: Record<TypewriterAlign, string> = { left: '⇤', center: '↔', right: '⇥', justify: '☰' }

const ptOf = (size: number) => String(Math.round(size * PAGE_PT * 10) / 10)

function btn(active: boolean, mixed: boolean): string {
  return `h-7 min-w-7 cursor-pointer rounded border px-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'border-blue-500 bg-blue-500/20' : mixed ? 'border-dashed border-gray-400' : 'border-gray-300'}`
}

export function TypewriterFormatControls({ values, onStyle, onAlign }: Props) {
  const { style, mixed, align } = values
  const [hex, setHex] = useState(style.color)
  const [hexInvalid, setHexInvalid] = useState(false)
  const [size, setSize] = useState(ptOf(style.size))
  const [pickerOpen, setPickerOpen] = useState(false)
  useEffect(() => {
    setHex(style.color)
    setHexInvalid(false)
  }, [style.color])
  useEffect(() => setSize(ptOf(style.size)), [style.size])

  const italicOk = familyHasItalic(style.family)
  const commitHex = () => {
    const parsed = parseHexInput(hex)
    if (!parsed) {
      setHexInvalid(true)
      return
    }
    setHexInvalid(false)
    if (parsed !== style.color) onStyle({ color: parsed })
  }
  const commitSize = () => {
    const pt = Number(size.replace(',', '.'))
    if (!Number.isFinite(pt) || pt <= 0) {
      setSize(ptOf(style.size))
      return
    }
    const next = Math.min(TYPEWRITER_MAX_SIZE, Math.max(TYPEWRITER_MIN_SIZE, pt / PAGE_PT))
    if (Math.abs(next - style.size) > 1e-9) onStyle({ size: next })
    else setSize(ptOf(style.size))
  }

  return (
    <div data-tw-format="" className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Typewriter format">
      <select
        aria-label="Font family"
        className="h-7 rounded border border-gray-300 bg-transparent px-1"
        value={mixed.has('family') ? '' : style.family}
        onChange={(e) => onStyle({ family: e.target.value as TypewriterFamilyId })}
      >
        {mixed.has('family') ? <option value="">Mixed</option> : null}
        {typewriterFamilies.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <input
        aria-label="Font size (pt)"
        className="h-7 w-14 rounded border border-gray-300 bg-transparent px-1 text-right"
        inputMode="decimal"
        value={mixed.has('size') ? '' : size}
        placeholder={mixed.has('size') ? 'Mixed' : undefined}
        onChange={(e) => setSize(e.target.value)}
        onBlur={commitSize}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commitSize()
        }}
      />
      <span className="relative">
        <button
          type="button"
          aria-label="Text colour"
          title="Text colour"
          className={btn(false, mixed.has('color'))}
          onMouseDown={keepFocus}
          onClick={() => setPickerOpen((o) => !o)}
        >
          <span aria-hidden className="inline-block h-3.5 w-3.5 rounded-sm border border-black/30 align-middle" style={{ background: mixed.has('color') ? 'transparent' : style.color }} />
        </button>
        {pickerOpen ? (
          <div className="absolute left-0 top-8 z-50 rounded bg-white p-2 shadow-lg" onMouseDown={keepFocus}>
            <HexColorPicker color={style.color} onChange={(c) => onStyle({ color: c.toUpperCase() })} />
          </div>
        ) : null}
      </span>
      <input
        aria-label="Colour HEX"
        aria-invalid={hexInvalid}
        className={`h-7 w-20 rounded border bg-transparent px-1 font-mono ${hexInvalid ? 'border-red-500' : 'border-gray-300'}`}
        value={mixed.has('color') && hex === style.color ? '' : hex}
        placeholder={mixed.has('color') ? 'Mixed' : '#RRGGBB'}
        spellCheck={false}
        onChange={(e) => {
          setHex(e.target.value)
          setHexInvalid(false)
        }}
        onBlur={commitHex}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commitHex()
        }}
      />
      {FLAGS.map((f) => {
        const disabled = f.key === 'italic' && !italicOk
        return (
          <button
            key={f.key}
            type="button"
            title={disabled ? 'This font family has no italic face' : f.title}
            aria-label={f.title}
            aria-pressed={mixed.has(f.key) ? 'mixed' : style[f.key]}
            disabled={disabled}
            className={`${btn(style[f.key] && !mixed.has(f.key), mixed.has(f.key))} ${f.css}`}
            onMouseDown={keepFocus}
            onClick={() => onStyle({ [f.key]: mixed.has(f.key) ? true : !style[f.key] })}
          >
            {f.label}
          </button>
        )
      })}
      {TYPEWRITER_ALIGNS.map((a) => (
        <button
          key={a}
          type="button"
          title={ALIGN_LABEL[a]}
          aria-label={`Align ${ALIGN_LABEL[a].toLowerCase()}`}
          aria-pressed={align === a}
          className={btn(align === a, align === 'mixed')}
          onMouseDown={keepFocus}
          onClick={() => onAlign(a)}
        >
          {ALIGN_GLYPH[a]}
        </button>
      ))}
    </div>
  )
}
