import type { ReactNode, Ref } from 'react'
import {
  TYPEWRITER_FONT_SIZES,
  normalizeTypewriterColorHex,
} from '@reading-book/shared/models'

export type TypewriterFormatState = {
  bold: boolean
  italic: boolean
  underline: boolean
  colorHex: string
  fontSize: number
}

type TypewriterFormatToolbarProps = {
  state: TypewriterFormatState
  onBold: () => void
  onItalic: () => void
  onUnderline: () => void
  onTextColor: (colorHex: string) => void
  onFontSize: (fontSize: number) => void
  /** Call before toolbar controls steal focus (color picker, etc.). */
  onSaveSelection?: () => void
  toolbarRef?: Ref<HTMLDivElement>
}

function ToolBtn({
  label,
  active,
  onClick,
  onSaveSelection,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  onSaveSelection?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? false}
      className={`rb-tw-toolbar-btn ${active ? 'is-active' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault()
        onSaveSelection?.()
      }}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** Compact Word-like formatting bar for an active typewriter textbox. */
export function TypewriterFormatToolbar({
  state,
  onBold,
  onItalic,
  onUnderline,
  onTextColor,
  onFontSize,
  onSaveSelection,
  toolbarRef,
}: TypewriterFormatToolbarProps) {
  const pickerValue = normalizeTypewriterColorHex(state.colorHex) ?? '#f59e0b'

  return (
    <div
      ref={toolbarRef}
      className="rb-tw-toolbar"
      role="toolbar"
      aria-label="Typewriter formatting"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation()
        onSaveSelection?.()
      }}
    >
      <ToolBtn
        label="Bold"
        active={state.bold}
        onSaveSelection={onSaveSelection}
        onClick={onBold}
      >
        <span className="font-bold">B</span>
      </ToolBtn>
      <ToolBtn
        label="Italic"
        active={state.italic}
        onSaveSelection={onSaveSelection}
        onClick={onItalic}
      >
        <span className="italic">I</span>
      </ToolBtn>
      <ToolBtn
        label="Underline"
        active={state.underline}
        onSaveSelection={onSaveSelection}
        onClick={onUnderline}
      >
        <span className="underline">U</span>
      </ToolBtn>

      <span className="rb-tw-toolbar-sep" aria-hidden />

      <label className="rb-tw-toolbar-size">
        <span className="sr-only">Font size</span>
        <select
          value={state.fontSize}
          aria-label="Font size"
          onMouseDown={(e) => {
            e.stopPropagation()
            onSaveSelection?.()
          }}
          onChange={(e) => onFontSize(Number(e.target.value))}
        >
          {TYPEWRITER_FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <span className="rb-tw-toolbar-sep" aria-hidden />

      <label
        className="rb-tw-color-picker"
        title="Text color"
        aria-label="Text color"
        onMouseDown={(e) => {
          e.stopPropagation()
          onSaveSelection?.()
        }}
      >
        <span
          className="rb-tw-color-picker-preview"
          style={{ color: pickerValue, borderBottomColor: pickerValue }}
          aria-hidden
        >
          A
        </span>
        <input
          type="color"
          value={pickerValue}
          aria-label="Pick text color"
          onInput={(e) => {
            const next = normalizeTypewriterColorHex(
              (e.target as HTMLInputElement).value,
            )
            if (next) onTextColor(next)
          }}
          onChange={(e) => {
            const next = normalizeTypewriterColorHex(e.target.value)
            if (next) onTextColor(next)
          }}
        />
      </label>
    </div>
  )
}
