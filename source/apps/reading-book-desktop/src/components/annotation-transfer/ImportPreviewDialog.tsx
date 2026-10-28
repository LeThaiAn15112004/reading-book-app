import { useEffect, useId } from 'react'
import { useAnnotationTransferStore } from '../../screens/Reader/logic/annotationTransferStore'

export type ImportPreviewDialogProps = {
  /** Receives the result message after a committed import (the host screen's toast). */
  onToast: (message: string | null) => void
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
export function ImportPreviewDialog({ onToast }: ImportPreviewDialogProps) {
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
            Import annotations
          </h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-5 text-sm leading-relaxed text-lib-muted">
          {failure ? (
            <p role="alert" className="m-0 mb-4 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-red-300">
              {failure.message}
            </p>
          ) : null}

          {preview ? (
            <>
              <p className="m-0 mb-1">
                <span className="text-lib-faint">File from:</span>{' '}
                <strong className="text-lib-text-strong">{preview.fileBook.title}</strong>
                {fileAuthor}
              </p>

              {preview.requiresChoice ? (
                <div className="my-3 rounded-lg border border-lib-border bg-lib-bg-mid/40 p-3" data-testid="annotation-import-choice">
                  <p className="m-0 mb-2 text-lib-text-strong">
                    {preview.fileBookMissing
                      ? `This file is from “${preview.fileBookMissing.title}”, which is not in your library.`
                      : preview.startedFrom && preview.target
                        ? `This file is from “${preview.target.title}”, but you started from “${preview.startedFrom.title}”.`
                        : 'Choose the book to import into.'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {preview.target ? (
                      <button type="button" className={primaryButton} disabled={busy} onClick={() => void chooseTarget(preview.target!.bookId)}>
                        Import into “{preview.target.title}”
                      </button>
                    ) : null}
                    {preview.startedFrom && preview.startedFrom.bookId !== preview.target?.bookId ? (
                      <button type="button" className={ghostButton} disabled={busy} onClick={() => void chooseTarget(preview.startedFrom!.bookId)}>
                        Import into “{preview.startedFrom.title}” anyway
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : preview.target ? (
                <p className="m-0 mb-1">
                  <span className="text-lib-faint">Import into:</span>{' '}
                  <strong className="text-lib-text-strong">{preview.target.title}</strong>
                  {preview.target.matchedBy === 'title' ? <span className="text-lib-faint"> (matched by title)</span> : null}
                </p>
              ) : null}

              {preview.target ? (
                <dl className="m-0 mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-lib-text-strong">
                  <dt>Will be added</dt>
                  <dd className="m-0 text-right tabular-nums">{preview.toAdd}</dd>
                  <dt>Already in the book</dt>
                  <dd className="m-0 text-right tabular-nums">{preview.present}</dd>
                  <dt>Cannot be placed</dt>
                  <dd className="m-0 text-right tabular-nums">{preview.notPlaced.length}</dd>
                </dl>
              ) : null}

              {preview.target && preview.notPlaced.length > 0 ? (
                <div className="mt-3">
                  <p className="m-0 mb-1 text-lib-faint">These could not be placed and will not be imported:</p>
                  <ul className="m-0 max-h-40 list-none overflow-y-auto rounded-lg border border-lib-border-soft p-0" aria-label="Annotations that cannot be placed">
                    {preview.notPlaced.map((n, i) => (
                      <li key={i} className="border-b border-lib-border-soft px-3 py-1.5 last:border-b-0">
                        <span className="text-lib-faint">{n.type ?? 'annotation'}</span>
                        {n.quote ? <span className="text-lib-text-strong"> “{n.quote.length > 120 ? `${n.quote.slice(0, 120)}…` : n.quote}”</span> : null}
                        <span className="block text-xs text-lib-faint">{n.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {importing && progress ? (
                <p className="m-0 mt-3 text-lib-faint" role="status">
                  Saving annotations…
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-lib-border-soft px-6 py-4">
          <button type="button" className={ghostButton} disabled={importing} onClick={closeImport}>
            {preview ? 'Cancel' : 'Close'}
          </button>
          {preview ? (
            <button type="button" className={primaryButton} disabled={!canImport} onClick={() => void confirmImport(onToast)}>
              {importing ? 'Importing…' : 'Import'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
