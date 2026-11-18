import { useT } from '../../../../i18n'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useBackClose } from '../../../../hooks/app/useBackClose'
import { useDialogFocus } from '../../../../hooks/app/useDialogFocus'
import { isMobileHost } from '../../../../platforms/host'

export type NewCollectionDialogProps = {
  open: boolean
  collection?: { name: string; description?: string } | null
  onClose: () => void
  onSubmit: (input: {
    name: string
    description?: string
  }) => boolean | void | Promise<boolean | void>
}

/** T1.9a — create a persisted Library collection. */
export function NewCollectionDialog({
  open,
  collection,
  onClose,
  onSubmit,
}: NewCollectionDialogProps) {
  const t = useT()
  const titleId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Phone: every target at least 44 px high (FR-005).
  const control = isMobileHost() ? 'h-11' : 'h-10'
  const action = isMobileHost() ? 'h-11' : 'h-[38px]'

  useEffect(() => {
    if (!open) return
    setName(collection?.name ?? '')
    setDescription(collection?.description ?? '')
    setSubmitting(false)
  }, [open, collection])

  // FR-016: focus stays inside while open and returns to the opener; FR-020: the phone's Back closes it.
  useDialogFocus(open, dialogRef, { initialFocusRef: nameRef })
  useBackClose(open, onClose)

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      const result = await onSubmit({
        name: trimmed,
        description: description.trim() || undefined,
      })
      if (result !== false) onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-lib-bg-deep/65 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-[0_20px_48px_rgba(0,0,0,0.45)]"
      >
        <h2
          id={titleId}
          className="m-0 mb-1 text-lg font-semibold text-lib-text-strong"
        >
          {collection ? t('library.collections.dialog.editTitle') : t('library.collections.dialog.newTitle')}
        </h2>
        <p className="m-0 mb-4 text-[13px] text-lib-muted">
          {collection
            ? t('library.collections.dialog.editBody')
            : t('library.collections.dialog.newBody')}
        </p>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1.5 text-[13px] text-lib-text">
            {t('library.collections.dialog.name')}
            <input
              ref={nameRef}
              type="text"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`${control} rounded-lg border border-lib-border bg-lib-input px-3 text-sm text-lib-text-strong outline-none focus:border-lib-accent focus:shadow-[0_0_0_3px_var(--color-lib-accent-soft)]`}
              placeholder={t('library.collections.dialog.namePlaceholder')}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-lib-text">
            {t('library.collections.dialog.description')}{' '}
            <span className="text-lib-muted">{t('library.collections.dialog.optional')}</span>
            <input
              type="text"
              maxLength={160}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${control} rounded-lg border border-lib-border bg-lib-input px-3 text-sm text-lib-text-strong outline-none focus:border-lib-accent focus:shadow-[0_0_0_3px_var(--color-lib-accent-soft)]`}
              placeholder={t('library.collections.dialog.descriptionPlaceholder')}
            />
          </label>

          <div className="mt-2 flex justify-end gap-2.5">
            <button
              type="button"
              className={`inline-flex ${action} cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-medium text-lib-muted transition-colors hover:bg-lib-surface-hover hover:text-lib-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent`}
              onClick={onClose}
            >
              {t('common.actions.cancel')}
            </button>
            <button
              type="submit"
              className={`inline-flex ${action} cursor-pointer items-center rounded-lg border-none bg-lib-accent px-4 text-[13px] font-semibold text-lib-on-accent transition-colors hover:bg-lib-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-not-allowed disabled:opacity-50`}
              disabled={!name.trim() || submitting}
            >
              {submitting
                ? t('library.collections.dialog.saving')
                : collection
                  ? t('common.actions.save')
                  : t('library.collections.dialog.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
