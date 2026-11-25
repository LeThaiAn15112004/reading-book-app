import { useEffect, useRef, useState } from 'react'
import { HIGHLIGHT_COLOR_PRESETS, type MessageKey } from '@core'
import { useBackClose } from '../../../../hooks/app/useBackClose'
import { useT } from '../../../../i18n'
import { isMarkKind, MARK_STYLES, type ActiveMark, type MarkKind } from '../logic/readingSurface'
import { MobileReaderIcon, type MobileReaderIconName } from './MobileReaderIcons'
import { MobileSheet } from './MobileSheet'

const STYLE_CHOICES: Record<MarkKind, { label: MessageKey; icon: MobileReaderIconName }> = {
  highlight: { label: 'reader.phone.mark.highlight', icon: 'edit' },
  underline: { label: 'reader.sidebar.notes.types.underline', icon: 'underline' },
  strikethrough: { label: 'reader.phone.mark.strike', icon: 'strike' },
}

/** The delete confirmation: its own layer, so Back closes it before the mark panel (spec 019 FR-001). */
function ConfirmDelete({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const t = useT()
  useBackClose(true, onCancel)
  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center p-6" role="presentation">
      <button type="button" aria-label={t('reader.phone.mark.confirmCancel')} className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="phone-mark-delete-title"
        className="relative w-full max-w-[360px] rounded-2xl border border-lib-border bg-lib-surface-strong p-5 text-lib-text shadow-2xl"
      >
        <h2 id="phone-mark-delete-title" className="m-0 text-[16px] font-semibold text-lib-text-strong">
          {t('reader.phone.mark.confirmTitle')}
        </h2>
        <p className="mt-2 mb-4 text-[14px] text-lib-muted">{t('reader.phone.mark.confirmBody')}</p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="focus-ring min-h-[48px] flex-1 rounded-xl border border-lib-border text-[14px] font-semibold text-lib-text-strong">
            {t('reader.phone.mark.confirmCancel')}
          </button>
          <button type="button" onClick={onConfirm} className="focus-ring min-h-[48px] flex-1 rounded-xl bg-[var(--lib-danger,#dc2626)] text-[14px] font-semibold text-white">
            {t('reader.phone.mark.confirmDelete')}
          </button>
        </div>
      </section>
    </div>
  )
}

/**
 * The panel of one mark, as a bottom sheet (spec 008 T103; spec 019 FR-015a / FR-016 / FR-023): colour, style, note,
 * copy, delete — the same for every format, opened by the mark's identity alone. A preset colour is stored as plain
 * `#RRGGBB`, like Desktop's picker. The note is a plain textarea inside the sheet; closing keeps what was typed.
 */
export function MobileMarkSheet({
  mark,
  confirmOpen,
  onOpenConfirm,
  onCloseConfirm,
  onCopy,
  onClose,
}: {
  mark: ActiveMark
  confirmOpen: boolean
  onOpenConfirm: () => void
  onCloseConfirm: () => void
  onCopy: (text: string) => void
  onClose: () => void
}) {
  const t = useT()
  const { highlight } = mark
  const [note, setNote] = useState(highlight.note ?? '')
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  const isNote = highlight.styleKind === 'textbox'
  const canRestyle = isMarkKind(highlight.styleKind)
  const noteChanged = note !== (highlight.note ?? '')

  useEffect(() => {
    if (mark.focusNote) noteRef.current?.focus()
    // Only when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = () => {
    // Closing keeps what was typed, like Desktop's popups (they save on dismiss).
    if (noteChanged) mark.setNote(note)
    onClose()
  }

  return (
    <>
      <MobileSheet title={isNote ? t('reader.phone.mark.note') : t('reader.phone.mark.highlight')} onClose={close}>
        <div className="flex flex-col gap-4 p-4">
          {highlight.selectionText?.highlight ? (
            <blockquote className="m-0 line-clamp-3 border-l-4 pl-3 text-[14px] text-lib-text" style={{ borderColor: highlight.colorHex || undefined }}>
              {highlight.selectionText.highlight}
            </blockquote>
          ) : null}

          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t('reader.chrome.ink.color')}>
            {HIGHLIGHT_COLOR_PRESETS.map((preset) => {
              const selected = highlight.colorHex.toLowerCase().startsWith(preset.hex.toLowerCase())
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={t(`reader.annotations.colors.${preset.id as 'yellow'}`) || preset.label}
                  onClick={() => mark.setColor(preset.hex)}
                  className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-black/70"
                  style={{
                    backgroundColor: preset.hex,
                    outline: selected ? '3px solid var(--color-lib-accent)' : '1px solid var(--color-lib-border)',
                    outlineOffset: 2,
                  }}
                >
                  {selected ? <MobileReaderIcon name="check" size={20} /> : null}
                </button>
              )
            })}
          </div>

          {canRestyle ? (
            <div className="flex gap-1 rounded-xl bg-lib-hint p-1" role="radiogroup" aria-label={t('reader.phone.mark.style')}>
              {MARK_STYLES.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={highlight.styleKind === kind}
                  onClick={() => mark.setStyle(kind)}
                  className={`focus-ring flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-lg text-[14px] font-semibold ${highlight.styleKind === kind ? 'bg-lib-surface text-lib-text-strong' : 'text-lib-muted'}`}
                >
                  <MobileReaderIcon name={STYLE_CHOICES[kind].icon} size={18} />
                  {t(STYLE_CHOICES[kind].label)}
                </button>
              ))}
            </div>
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-bold tracking-wide text-lib-faint uppercase">{t('reader.phone.mark.note')}</span>
            <textarea
              ref={noteRef}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder={t('reader.phone.mark.placeholder')}
              // 16 px: iOS zooms the page into a smaller field on focus.
              className="min-h-[88px] w-full resize-none rounded-xl border border-lib-border bg-lib-input p-3 text-[16px] text-lib-text"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!noteChanged}
              onClick={() => mark.setNote(note)}
              className="focus-ring min-h-[48px] flex-1 rounded-xl bg-lib-accent text-[14px] font-semibold text-lib-on-accent disabled:opacity-40"
            >
              {t('reader.phone.mark.saveNote')}
            </button>
            <button
              type="button"
              onClick={() => onCopy(highlight.selectionText?.highlight ?? '')}
              aria-label={t('reader.phone.mark.copy')}
              className="focus-ring flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-lib-border text-lib-text-strong"
            >
              <MobileReaderIcon name="copy" />
            </button>
            <button
              type="button"
              onClick={onOpenConfirm}
              aria-label={t('reader.phone.mark.delete')}
              className="focus-ring flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-lib-border text-[var(--lib-danger,#dc2626)]"
            >
              <MobileReaderIcon name="delete" />
            </button>
          </div>
        </div>
      </MobileSheet>
      {confirmOpen ? (
        <ConfirmDelete
          onCancel={onCloseConfirm}
          onConfirm={() => {
            onCloseConfirm()
            mark.remove()
            onClose()
          }}
        />
      ) : null}
    </>
  )
}
