import { useEffect, useState } from 'react'

type NoteModalProps = {
  open: boolean
  quote: string
  onClose: () => void
  onSave: (content: string) => void
}

export function NoteModal({ open, quote, onClose, onSave }: NoteModalProps) {
  const [content, setContent] = useState('')

  useEffect(() => {
    if (open) setContent('')
  }, [open, quote])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[450px] flex-col gap-4 rounded-xl border border-slate-600/45 bg-slate-900/95 p-5 shadow-xl"
        role="dialog"
        aria-labelledby="note-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="text-base font-semibold text-slate-100"
          id="note-modal-title"
        >
          Add note
        </div>
        {quote ? (
          <div className="border-l-[3px] border-amber-500 pl-2.5 font-serif text-sm leading-snug text-slate-400 italic">
            “{quote}”
          </div>
        ) : null}
        <textarea
          className="box-border h-[100px] w-full resize-none rounded-lg border border-slate-600/45 bg-slate-950 p-2.5 text-[15px] text-slate-100 outline-none focus:border-amber-500/55"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write your note…"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button
            className="h-10 cursor-pointer rounded-lg border border-slate-600/45 bg-slate-800/50 px-4 text-[13px] font-semibold text-slate-300"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="h-10 cursor-pointer rounded-lg border border-amber-500 bg-amber-500 px-4 text-[13px] font-semibold text-slate-950"
            type="button"
            onClick={() => {
              const trimmed = content.trim()
              if (!trimmed) return
              onSave(trimmed)
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
