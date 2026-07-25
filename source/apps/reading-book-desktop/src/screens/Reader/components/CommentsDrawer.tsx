import { useState } from 'react'
import type { ReaderComment } from '../readerSession'

type CommentsDrawerProps = {
  open: boolean
  chapterLabel: string
  paragraphPreview: string
  comments: ReaderComment[]
  onClose: () => void
  onSubmit: (content: string) => void
}

export function CommentsDrawer({
  open,
  chapterLabel,
  paragraphPreview,
  comments,
  onClose,
  onSubmit,
}: CommentsDrawerProps) {
  const [draft, setDraft] = useState('')

  return (
    <>
      <div
        className={`fixed inset-0 z-[170] bg-slate-950/35 transition-opacity ${
          open
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`fixed right-0 bottom-0 left-0 z-[180] flex h-[min(78%,560px)] max-h-[calc(100dvh-48px)] flex-col rounded-t-2xl border-t border-slate-600/45 bg-slate-900/95 shadow-xl backdrop-blur-xl transition-transform duration-250 ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
        aria-hidden={!open}
        role="dialog"
        aria-label="Comments"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-600/30 p-4">
          <div>
            <h3 className="m-0 text-[15px] font-semibold text-slate-100">
              Comment & answer
            </h3>
            <p className="mt-1 mb-0 text-xs leading-snug text-slate-500">
              {chapterLabel}
              {paragraphPreview
                ? ` · “${paragraphPreview.slice(0, 48)}${paragraphPreview.length > 48 ? '…' : ''}”`
                : ''}
            </p>
          </div>
          <button
            className="inline-flex size-9 cursor-pointer items-center justify-center border-none bg-transparent text-slate-400"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="app-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {comments.length === 0 ? (
            <p className="m-0 px-4 py-6 text-center text-[13px] text-slate-500">
              No comments on this passage yet.
            </p>
          ) : (
            comments.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-slate-600/30 bg-slate-950/30 p-3"
              >
                <div className="mb-1.5 flex justify-between gap-2 text-[11px] text-slate-500">
                  <span className="font-semibold text-amber-400">
                    {c.authorName}
                  </span>
                  <span>
                    {new Date(c.createdAt).toLocaleString(undefined, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
                <p className="m-0 text-[13px] leading-snug text-slate-300">
                  {c.content}
                </p>
              </div>
            ))
          )}
        </div>

        <form
          className="flex gap-2 border-t border-slate-600/30 bg-slate-900/95 px-4 pt-3 pb-4"
          onSubmit={(e) => {
            e.preventDefault()
            const text = draft.trim()
            if (!text) return
            onSubmit(text)
            setDraft('')
          }}
        >
          <input
            className="h-11 flex-1 rounded-lg border border-slate-600/45 bg-slate-950 px-3 text-[15px] text-slate-100 outline-none focus:border-amber-500/55"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Answer / note for this passage…"
            aria-label="Comment text"
          />
          <button
            className="h-11 cursor-pointer rounded-lg border-none bg-amber-500 px-4 font-bold text-slate-950"
            type="submit"
          >
            Save
          </button>
        </form>
      </aside>
    </>
  )
}
