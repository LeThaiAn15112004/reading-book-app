import { useEffect } from 'react'
import { useAttachmentsStore } from '../../logic/attachments/attachmentsStore'
import { AttachmentBlockedDialog, AttachmentOpenDialog } from '../dialogs/AttachmentDialogs'
import { useFormat, useT } from '../../../../i18n'

const EMPTY = 'm-0 px-2 py-6 text-center text-[13px] leading-relaxed text-lib-faint'

/**
 * Sidebar → Attachment for a PDF: the files embedded in it. Listed lazily (this panel only mounts
 * when its tab is open); a double-click starts the confirm → open workflow in `attachmentsStore`.
 */
export function AttachmentsPanel({ bookId }: { bookId: string }) {
  const t = useT()
  const format = useFormat()
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
            aria-label={t('reader.sidebar.attachments.dismiss')}
            onClick={clearNotice}
          >
            ✕
          </button>
        </div>
      ) : null}

      {status === 'loading' && items.length === 0 ? <p className={EMPTY}>{t('reader.sidebar.attachments.looking')}</p> : null}
      {status === 'error' ? <p className={EMPTY}>{loadError}</p> : null}
      {status === 'ready' && items.length === 0 ? (
        <p className={EMPTY}>{t('reader.sidebar.attachments.none')}</p>
      ) : null}

      {items.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label={t('reader.sidebar.attachments.list')}>
          {items.map((item) => {
            const size = item.size === null ? null : format.bytes(item.size)
            const meta = [item.page ? t('reader.sidebar.attachments.page', { page: item.page }) : t('reader.sidebar.attachments.document'), size].filter(Boolean).join(' · ')
            return (
              <li key={item.id}>
                <button
                  className={`flex w-full cursor-pointer flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left ${
                    selectedId === item.id
                      ? 'border-lib-accent bg-lib-accent-soft'
                      : 'border-lib-border bg-lib-bg-mid/50'
                  }`}
                  type="button"
                  title={t('reader.sidebar.attachments.doubleClick')}
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
        <p className={EMPTY}>{t('reader.sidebar.attachments.truncated', { count: items.length })}</p>
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
