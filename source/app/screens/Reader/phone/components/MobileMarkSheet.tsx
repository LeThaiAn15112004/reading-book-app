import { useState } from 'react'
import { HIGHLIGHT_COLOR_PRESETS, type HighlightStyleKind, type ReaderHighlightBase } from '@core'
import { MobileSheet } from './MobileSheet'

const STYLE_CHOICES: { kind: HighlightStyleKind; label: string }[] = [
  { kind: 'highlight', label: 'Highlight' },
  { kind: 'underline', label: 'Underline' },
  { kind: 'strikethrough', label: 'Strike' },
]

/**
 * The menu of one mark, as a bottom sheet (spec 008, T103; `contracts/phone-ui.md`: "a long press on an existing mark
 * opens its menu"). Colour, style, note, copy and delete call the open surface's store, the same calls as Desktop's
 * `NoteFloatingMenu` / `HighlightEditPopup`. A preset colour is stored as plain `#RRGGBB`, like Desktop's picker.
 *
 * The note is a plain textarea inside the sheet: the sheet sits at the bottom and the WebView resizes with the soft
 * keyboard, so the field stays above it (risk R6, checked on the device in T094).
 */
export function MobileMarkSheet({
  highlight,
  onChangeColor,
  onChangeStyle,
  onChangeNote,
  onCopy,
  onDelete,
  onClose,
}: {
  highlight: ReaderHighlightBase
  onChangeColor: (hex: string) => void
  onChangeStyle: (kind: HighlightStyleKind) => void
  onChangeNote: (note: string) => void
  onCopy: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const [note, setNote] = useState(highlight.note ?? '')
  const isNote = highlight.styleKind === 'textbox'
  const canRestyle = STYLE_CHOICES.some((choice) => choice.kind === highlight.styleKind)
  const noteChanged = note !== (highlight.note ?? '')

  const close = () => {
    // Closing keeps what was typed, like Desktop's popups (they save on dismiss).
    if (noteChanged) onChangeNote(note)
    onClose()
  }

  return (
    <MobileSheet title={isNote ? 'Note' : 'Highlight'} onClose={close}>
      <div className="flex flex-col gap-4 p-4">
        {highlight.selectionText?.highlight ? (
          <blockquote className="line-clamp-3 border-l-4 pl-3 text-[14px] text-lib-text" style={{ borderColor: highlight.colorHex || undefined }}>
            {highlight.selectionText.highlight}
          </blockquote>
        ) : null}

        <div className="flex items-center gap-3" role="radiogroup" aria-label="Colour">
          {HIGHLIGHT_COLOR_PRESETS.map((preset) => {
            const selected = highlight.colorHex.toLowerCase() === preset.hex.toLowerCase()
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={preset.label}
                onClick={() => onChangeColor(preset.hex)}
                className="h-11 w-11 shrink-0 rounded-full"
                style={{
                  backgroundColor: preset.hex,
                  outline: selected ? '3px solid var(--color-lib-accent)' : '1px solid var(--color-lib-border)',
                  outlineOffset: 2,
                }}
              />
            )
          })}
        </div>

        {canRestyle ? (
          <div className="flex gap-1 rounded-xl bg-lib-hint p-1" role="radiogroup" aria-label="Style">
            {STYLE_CHOICES.map((choice) => (
              <button
                key={choice.kind}
                type="button"
                role="radio"
                aria-checked={highlight.styleKind === choice.kind}
                onClick={() => onChangeStyle(choice.kind)}
                className={`min-h-[44px] flex-1 rounded-lg text-[14px] font-semibold ${highlight.styleKind === choice.kind ? 'bg-lib-surface text-lib-text-strong' : 'text-lib-muted'}`}
              >
                {choice.label}
              </button>
            ))}
          </div>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold tracking-wide text-lib-faint uppercase">Note</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Add a note…"
            // 16 px: iOS zooms the page into a smaller field on focus.
            className="min-h-[88px] w-full resize-none rounded-xl border border-lib-border bg-lib-input p-3 text-[16px] text-lib-text"
          />
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={!noteChanged}
            onClick={() => onChangeNote(note)}
            className="min-h-[44px] flex-1 rounded-xl bg-lib-accent text-[14px] font-semibold text-lib-on-accent disabled:opacity-40"
          >
            Save note
          </button>
          <button type="button" onClick={onCopy} className="min-h-[44px] flex-1 rounded-xl border border-lib-border text-[14px] font-semibold text-lib-text-strong">
            Copy
          </button>
          <button type="button" onClick={onDelete} className="min-h-[44px] flex-1 rounded-xl border border-lib-border text-[14px] font-semibold text-red-500">
            Delete
          </button>
        </div>
      </div>
    </MobileSheet>
  )
}
