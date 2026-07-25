import type { ReaderSignature } from '../readerSession'

type SignInfoPanelProps = {
  open: boolean
  isSigned: boolean
  signatures: ReaderSignature[]
  onClose: () => void
}

export function SignInfoPanel({
  open,
  isSigned,
  signatures,
  onClose,
}: SignInfoPanelProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[450px] flex-col gap-4 rounded-xl border border-slate-600/45 bg-slate-900/95 p-5 shadow-xl"
        role="dialog"
        aria-labelledby="sign-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="text-base font-semibold text-slate-100"
          id="sign-panel-title"
        >
          Digital signatures
        </div>
        <p className="m-0 text-[13px] leading-snug text-slate-400">
          {isSigned || signatures.length > 0
            ? 'This document has signature metadata (local preview).'
            : 'No digital signatures detected for this document.'}
        </p>
        {signatures.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {signatures.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-600/30 bg-white/[0.03] px-3 py-2.5 text-[13px] text-slate-300"
              >
                <strong className="text-slate-100">{s.signerName}</strong>
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-400 uppercase">
                  {s.signatureStatus}
                </span>
                {s.signedAt ? (
                  <span className="w-full text-[11px] text-slate-500">
                    {new Date(s.signedAt).toLocaleString()}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end">
          <button
            className="h-10 cursor-pointer rounded-lg border border-amber-500 bg-amber-500 px-4 text-[13px] font-semibold text-slate-950"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
