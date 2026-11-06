import { useEffect } from 'react'
import { useAttachmentsStore } from '../../logic/attachments/attachmentsStore'
import { AttachmentBlockedDialog, AttachmentOpenDialog } from '../dialogs/AttachmentDialogs'

const EMPTY = 'm-0 px-2 py-6 text-center text-[13px] leading-relaxed text-lib-faint'

function formatSize(bytes: number | null): string | null {
  if (bytes === null) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Sidebar → Attachment for a PDF: the files embedded in it. Listed lazily (this panel only mounts
 * when its tab is open); a double-click starts the confirm → open workflow in `attachmentsStore`.
 */
export function AttachmentsPanel({ bookId }: { bookId: string }) {
  const status = useAttachmentsStore((s) => s.status)
  const items = useAttachmentsStore((s) => s.items)
  const truncated = useAttachmentsStore((s) => s.truncated)
  const loadError = useAttachmentsStore((s) => s.loadError)
  const selectedId = useAttachmentsStore((s) => s.selectedId)
  const confirming = useAttachmentsStore((s) => s.confirming)
  const blocked = useAttachmentsStore((s) => s.blocked)
  const busy = useAttachmentsStore((s) => s.busy)
  const notice = useAttachmentsStore((s) => s.notice)
  const { load, select, requestOpen, cancelOpen, confirmOpen, saveBlocked, dismissBlocked, clearNotice } =
    useAttachmentsStore.getState()

  useEffect(() => {
    void load(bookId)
  }, [bookId, load])

  return (
    <>
      {notice ? (
        <div
          className={`mb-2 flex items-start justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs leading-snug ${
            notice.kind === 'error'
              ? 'border-lib-accent bg-lib-accent-soft text-lib-text'
              : 'border-lib-border bg-lib-bg-mid/50 text-lib-muted'
          }`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          <span>{notice.message}</span>
          <button
            className="cursor-pointer border-0 bg-transparent p-0 text-xs text-lib-faint"
            type="button"
            aria-label="Dismiss"
            onClick={clearNotice}
          >
            ✕
          </button>
        </div>
      ) : null}

      {status === 'loading' && items.length === 0 ? <p className={EMPTY}>Looking for attachments…</p> : null}
      {status === 'error' ? <p className={EMPTY}>{loadError}</p> : null}
      {status === 'ready' && items.length === 0 ? (
        <p className={EMPTY}>No attachments in this PDF.</p>
      ) : null}

      {items.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Attachments">
          {items.map((item) => {
            const size = formatSize(item.size)
            const meta = [item.page ? `Page ${item.page}` : 'Document', size].filter(Boolean).join(' · ')
            return (
              <li key={item.id}>
                <button
                  className={`flex w-full cursor-pointer flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left ${
                    selectedId === item.id
                      ? 'border-lib-accent bg-lib-accent-soft'
                      : 'border-lib-border bg-lib-bg-mid/50'
                  }`}
                  type="button"
                  title="Double-click to open"
                  onClick={() => select(item.id)}
                  onDoubleClick={() => requestOpen(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') requestOpen(item)
                  }}
                >
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-lib-text">
                    <span aria-hidden>📎</span>
                    <span className="break-all">{item.name}</span>
                  </span>
                  <span className="text-xs text-lib-muted">{meta}</span>
                  {item.description ? (
                    <span className="line-clamp-2 text-xs text-lib-faint">{item.description}</span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
      {truncated ? (
        <p className={EMPTY}>Only the first {items.length} attachments are shown.</p>
      ) : null}

      <AttachmentOpenDialog
        fileName={confirming?.name ?? null}
        onCancel={cancelOpen}
        onContinue={() => void confirmOpen()}
      />
      <AttachmentBlockedDialog
        fileName={blocked?.attachment.name ?? null}
        reason={blocked?.message ?? ''}
        busy={busy}
        onSaveAs={() => void saveBlocked()}
        onClose={dismissBlocked}
      />
    </>
  )
}
