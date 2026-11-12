import { useBookSignature } from '../../logic/hooks/useBookSignature'
import {
  SIGNATURE_CHECKING,
  SIGNATURE_LABELS,
  SIGNATURE_UNAVAILABLE,
  type SignatureTone,
} from '../../logic/bookSignature/signatureLabels'
import { getFormat, useT } from '../../../../i18n'

type SignInfoPanelProps = {
  open: boolean
  bookId: string | undefined
  onClose: () => void
}

const TONE_CLASS: Record<SignatureTone, string> = {
  ok: 'bg-lib-accent-soft text-lib-accent',
  warn: 'bg-red-500/15 text-red-500',
  neutral: 'bg-lib-surface text-lib-muted',
}

/** Read-only "is this book signed?" panel. The app verifies signatures; it never creates them. */
export function SignInfoPanel({ open, bookId, onClose }: SignInfoPanelProps) {
  const t = useT()
  const { signature, loading, failed } = useBookSignature(bookId, open)
  if (!open) return null

  const label = signature ? SIGNATURE_LABELS[signature.status] : undefined
  const summary = label
    ? t(label.detail)
    : failed
      ? t('reader.tools.signature.unavailableFile')
      : t('reader.tools.signature.checking')

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-lib-bg-deep/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[450px] flex-col gap-4 rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-xl"
        role="dialog"
        aria-labelledby="sign-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="text-base font-semibold text-lib-text-strong"
          id="sign-panel-title"
        >
          {t('reader.tools.signature.title')}
        </div>
        <p className="m-0 text-[13px] leading-snug text-lib-muted">{summary}</p>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-lib-border-soft bg-lib-surface px-3 py-2.5 text-[13px] text-lib-text">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${TONE_CLASS[label?.tone ?? 'neutral']}`}
          >
            {t(label?.label ?? (loading ? SIGNATURE_CHECKING : SIGNATURE_UNAVAILABLE))}
          </span>
          {signature?.signerName ? (
            <strong className="text-lib-text-strong">{signature.signerName}</strong>
          ) : null}
          {signature?.signedAt ? (
            <span className="w-full text-[11px] text-lib-faint">
              {t('reader.tools.signature.signedAt', { date: getFormat().dateTime(new Date(signature.signedAt)) })}
            </span>
          ) : null}
          {signature?.checkedAt ? (
            <span className="w-full text-[11px] text-lib-faint">
              {t('reader.tools.signature.checkedAt', { date: getFormat().dateTime(new Date(signature.checkedAt)) })}
            </span>
          ) : null}
        </div>
        <div className="flex justify-end">
          <button
            className="h-10 cursor-pointer rounded-lg border border-lib-accent bg-lib-accent px-4 text-[13px] font-semibold text-lib-on-accent"
            type="button"
            onClick={onClose}
          >
            {t('common.actions.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
