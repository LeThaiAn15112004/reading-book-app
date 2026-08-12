import type { ReactNode, Ref } from 'react'
import {
  TYPEWRITER_FONT_SIZES,
  normalizeTypewriterColorHex,
  stepTypewriterFontSize,
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
  /** Open the shared right reader panel (typewriter detail UI, etc.). */
  onOpenSidePanel?: () => void
  sidePanelOpen?: boolean
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

/** Compact floating bar: B/I/U, A+/A−, color, and right-panel toggle. */
export function TypewriterFormatToolbar({
  state,
  onBold,
  onItalic,
  onUnderline,
  onTextColor,
  onFontSize,
  onOpenSidePanel,
  sidePanelOpen = false,
  onSaveSelection,
  toolbarRef,
}: TypewriterFormatToolbarProps) {
  const pickerValue = normalizeTypewriterColorHex(state.colorHex) ?? '#f59e0b'
  const canShrink =
    state.fontSize > (TYPEWRITER_FONT_SIZES[0] ?? state.fontSize)
  const canGrow =
    state.fontSize <
    (TYPEWRITER_FONT_SIZES[TYPEWRITER_FONT_SIZES.length - 1] ?? state.fontSize)

  return (
    <div
      ref={toolbarRef}
      className="rb-tw-toolbar"
      role="toolbar"
      aria-label="Typewriter formatting"
      onMouseDown={(e) => {
        // Keep contenteditable focused while using toolbar controls.
        if ((e.target as HTMLElement | null)?.closest?.('select, input')) return
        e.preventDefault()
      }}
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

      <ToolBtn
        label="Decrease font size"
        onSaveSelection={onSaveSelection}
        onClick={() => {
          if (!canShrink) return
          onFontSize(stepTypewriterFontSize(state.fontSize, -1))
        }}
      >
        <span className="rb-tw-toolbar-a">A−</span>
      </ToolBtn>
      <ToolBtn
        label="Increase font size"
        onSaveSelection={onSaveSelection}
        onClick={() => {
          if (!canGrow) return
          onFontSize(stepTypewriterFontSize(state.fontSize, 1))
        }}
      >
        <span className="rb-tw-toolbar-a rb-tw-toolbar-a-lg">A+</span>
      </ToolBtn>

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

      {onOpenSidePanel ? (
        <>
          <span className="rb-tw-toolbar-sep" aria-hidden />
          <ToolBtn
            label={sidePanelOpen ? 'Close side panel' : 'Open side panel'}
            active={sidePanelOpen}
            onSaveSelection={onSaveSelection}
            onClick={onOpenSidePanel}
          >
            <span className="rb-tw-toolbar-panel-icon" aria-hidden>
              ▤
            </span>
          </ToolBtn>
        </>
      ) : null}
    </div>
  )
}
