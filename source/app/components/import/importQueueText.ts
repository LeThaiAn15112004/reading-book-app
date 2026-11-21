import { summarizeBatch, type ImportMessage, type ImportPlaceholder, type ImportQueue, type ImportStep } from '@core'
import type { Translator } from '@core'

/** Text under a placeholder: "Importing… 42 %", "Importing…" or "Waiting". */
export function placeholderStatus(t: Translator, p: ImportPlaceholder): string {
  if (p.state === 'waiting') return t('import.queue.placeholder.waiting')
  return p.percent !== null ? t('import.queue.placeholder.importing', { percent: p.percent }) : t('import.queue.placeholder.importingNoPercent')
}

/** A host message (already translated) or a catalogue reference, as text. */
export function messageText(t: Translator, message: ImportMessage): string {
  return typeof message === 'string' ? message : t(message.key as never, message.params as never)
}

export function stepLabel(t: Translator, step: ImportStep | null): string {
  return t(`import.queue.step.${step ?? 'checking'}`)
}

/** "4 added · 1 failed" — the result pill of a finished batch (groups at 0 left out). */
export function batchSummaryLine(t: Translator, queue: ImportQueue, batchId: string): string {
  const s = summarizeBatch(queue, batchId)
  if (!s) return ''
  return s.groups
    .map((g) => {
      const count =
        g === 'added' ? s.added : g === 'already' ? s.alreadyInLibrary : g === 'failed' ? s.failed.length : g === 'cancelled' ? s.cancelled : s.interrupted.length
      return t(`import.queue.summary.${g}`, { count })
    })
    .join(' · ')
}
