import { useEffect, useId, useState } from 'react'
import { useAnnotationTransferStore } from '../../screens/Reader/logic/annotationTransferStore'
import type { MessageKey } from '@core'
import { uiText, useT } from '../../i18n'

export type ImportPreviewDialogProps = {
  /** Receives the result message after a committed import (the host screen's toast). */
  onToast: (message: string | null) => void
  /** The library's books, so the reader can deliberately pick another book of the file's format (the Library flow). */
  bookChoices?: readonly { id: string; title: string; format: string }[]
}

const buttonBase =
  'inline-flex h-[38px] cursor-pointer items-center rounded-lg border px-4 text-[13px] font-medium transition-colors disabled:cursor-default disabled:opacity-45'
const ghostButton = `${buttonBase} border-lib-border bg-transparent text-lib-muted hover:text-lib-text-strong`
const primaryButton = `${buttonBase} border-lib-accent bg-lib-accent-soft text-lib-text-strong hover:bg-lib-accent/20`

/**
 * Import preview (specs/006-annotation-import-export, FR-005 / FR-010): which book the file is from, which book it will go
 * into, how many annotations are added / already there / cannot be placed, and — when the file belongs to another book than
 * the one the import was started from — the deliberate choice of target. Nothing is written until Import is pressed.
 */
/** "Choose another book…": a book of the same format as the file, chosen on purpose. */
function BookPicker({ choices, disabled, onChoose }: { choices: readonly { id: string; title: string }[]; disabled: boolean; onChoose: (bookId: string) => void }) {
  const t = useT()
  const [selected, setSelected] = useState('')
  if (choices.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="text-lib-faint" htmlFor="annotation-import-book">
        {t('reader.annotations.import.otherBook')}
      </label>
      <select
        id="annotation-import-book"
        className="h-[34px] max-w-[240px] rounded-lg border border-lib-border bg-lib-bg-mid/50 px-2 text-[13px] text-lib-text-strong"
        value={selected}
        disabled={disabled}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">{t('reader.annotations.import.selectBook')}</option>
        {choices.map((b) => (
          <option key={b.id} value={b.id}>
            {b.title}
          </option>
        ))}
      </select>
      <button type="button" className={ghostButton} disabled={disabled || !selected} onClick={() => onChoose(selected)}>
        {t('reader.annotations.import.intoThisBook')}
      </button>
    </div>
  )
}

/** Annotation types in the "not placed" list, by the stored `type` (spec 012). */
const TYPE_LABELS: Readonly<Record<string, MessageKey>> = {
  highlight: 'reader.sidebar.notes.types.highlight',
  underline: 'reader.sidebar.notes.types.underline',
  strikethrough: 'reader.sidebar.notes.types.strikethrough',
  squiggly: 'reader.sidebar.notes.types.squiggly',
  replace: 'reader.sidebar.notes.types.replace',
  insert: 'reader.sidebar.notes.types.insert',
  note: 'reader.sidebar.notes.types.textbox',
  textbox: 'reader.sidebar.notes.types.textbox',
  rectangle: 'reader.sidebar.notes.types.rectangle',
  ellipse: 'reader.sidebar.notes.types.ellipse',
  line: 'reader.sidebar.notes.types.line',
  arrow: 'reader.sidebar.notes.types.arrow',
  typewriter: 'reader.sidebar.notes.types.typewriter',
}

export function ImportPreviewDialog({ onToast, bookChoices }: ImportPreviewDialogProps) {
  const t = useT()
  const titleId = useId()
  const preview = useAnnotationTransferStore((s) => s.preview)
  const failure = useAnnotationTransferStore((s) => s.importFailure)
  const picking = useAnnotationTransferStore((s) => s.picking)
  const importing = useAnnotationTransferStore((s) => s.importing)
  const progress = useAnnotationTransferStore((s) => s.progress)
  const chooseTarget = useAnnotationTransferStore((s) => s.chooseTarget)
  const confirmImport = useAnnotationTransferStore((s) => s.confirmImport)
  const closeImport = useAnnotationTransferStore((s) => s.closeImport)

  const open = preview !== null || failure !== null
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !importing) {
        e.preventDefault()
        closeImport()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, importing, closeImport])

  if (!open) return null

  const busy = picking || importing
  const canImport = !!preview && !!preview.target && !preview.requiresChoice && !busy
  const fileAuthor = preview?.fileBook.author ? ` — ${preview.fileBook.author}` : ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !importing) closeImport()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(640px,calc(100vh-32px))] w-full max-w-[520px] flex-col overflow-hidden rounded-xl border border-lib-border bg-lib-surface-strong shadow-[0_20px_48px_rgba(0,0,0,0.45)]"
      >
        <div className="border-b border-lib-border-soft px-6 pt-5 pb-3.5">
          <h2 id={titleId} className="m-0 text-lg font-semibold text-lib-accent">
            {t('reader.annotations.import.title')}
          </h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-5 text-sm leading-relaxed text-lib-muted">
          {failure ? (
            <p role="alert" className="m-0 mb-4 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-red-300">
              {uiText(t, failure.message)}
            </p>
          ) : null}

          {preview ? (
            <>
              <p className="m-0 mb-1">
                <span className="text-lib-faint">{t('reader.annotations.import.fileFrom')}</span>{' '}
                <strong className="text-lib-text-strong">{preview.fileBook.title}</strong>
                {fileAuthor}
              </p>

              {preview.requiresChoice ? (
                <div className="my-3 rounded-lg border border-lib-border bg-lib-bg-mid/40 p-3" data-testid="annotation-import-choice">
                  <p className="m-0 mb-2 text-lib-text-strong">
                    {preview.fileBookMissing
                      ? t('reader.annotations.import.missingBook', { title: preview.fileBookMissing.title })
                      : preview.startedFrom && preview.target
                        ? t('reader.annotations.import.otherThanStarted', { target: preview.target.title, started: preview.startedFrom.title })
                        : t('reader.annotations.import.chooseBook')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {preview.target ? (
                      <button type="button" className={primaryButton} disabled={busy} onClick={() => void chooseTarget(preview.target!.bookId)}>
                        {t('reader.annotations.import.intoNamed', { title: preview.target.title })}
                      </button>
                    ) : null}
                    {preview.startedFrom && preview.startedFrom.bookId !== preview.target?.bookId ? (
                      <button type="button" className={ghostButton} disabled={busy} onClick={() => void chooseTarget(preview.startedFrom!.bookId)}>
                        {t('reader.annotations.import.intoNamedAnyway', { title: preview.startedFrom.title })}
                      </button>
                    ) : null}
                  </div>
                  {bookChoices ? (
                    <BookPicker
                      choices={bookChoices.filter((b) => b.format === preview.fileBook.format && b.id !== preview.target?.bookId && b.id !== preview.startedFrom?.bookId)}
                      disabled={busy}
                      onChoose={(id) => void chooseTarget(id)}
                    />
                  ) : null}
                </div>
              ) : preview.target ? (
                <p className="m-0 mb-1">
                  <span className="text-lib-faint">{t('reader.annotations.import.importInto')}</span>{' '}
                  <strong className="text-lib-text-strong">{preview.target.title}</strong>
                  {preview.target.matchedBy === 'title' ? <span className="text-lib-faint">{t('reader.annotations.import.matchedByTitle')}</span> : null}
                </p>
              ) : null}

              {preview.target ? (
                <dl className="m-0 mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-lib-text-strong">
                  <dt>{t('reader.annotations.import.willAdd')}</dt>
                  <dd className="m-0 text-right tabular-nums">{preview.toAdd}</dd>
                  <dt>{t('reader.annotations.import.alreadyThere')}</dt>
                  <dd className="m-0 text-right tabular-nums">{preview.present}</dd>
                  <dt>{t('reader.annotations.import.cannotPlace')}</dt>
                  <dd className="m-0 text-right tabular-nums">{preview.notPlaced.length}</dd>
                </dl>
              ) : null}

              {preview.target && preview.notPlaced.length > 0 ? (
                <div className="mt-3">
                  <p className="m-0 mb-1 text-lib-faint">{t('reader.annotations.import.notPlacedIntro')}</p>
                  <ul className="m-0 max-h-40 list-none overflow-y-auto rounded-lg border border-lib-border-soft p-0" aria-label={t('reader.annotations.import.notPlacedAria')}>
                    {preview.notPlaced.map((n, i) => (
                      <li key={i} className="border-b border-lib-border-soft px-3 py-1.5 last:border-b-0">
                        <span className="text-lib-faint">{n.type ? (n.type in TYPE_LABELS ? t(TYPE_LABELS[n.type]!) : n.type) : t('reader.annotations.import.annotation')}</span>
                        {n.quote ? <span className="text-lib-text-strong"> “{n.quote.length > 120 ? `${n.quote.slice(0, 120)}…` : n.quote}”</span> : null}
                        <span className="block text-xs text-lib-faint">{n.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {importing && progress ? (
                <p className="m-0 mt-3 text-lib-faint" role="status">
                  {t('reader.annotations.import.saving')}
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-lib-border-soft px-6 py-4">
          <button type="button" className={ghostButton} disabled={importing} onClick={closeImport}>
            {preview ? t('common.actions.cancel') : t('common.actions.close')}
          </button>
          {preview ? (
            <button type="button" className={primaryButton} disabled={!canImport} onClick={() => void confirmImport(onToast)}>
              {importing ? t('reader.annotations.import.importing') : t('reader.annotations.import.import')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
