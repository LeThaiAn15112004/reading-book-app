import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

export type NewCollectionDialogProps = {
  open: boolean
  onClose: () => void
  /** G1 stub: parent may keep the collection in memory only. */
  onCreate: (input: { name: string; description?: string }) => void
}

/** T1.9a — stub New collection dialog (persist / COLLECTION CRUD in later phase). */
export function NewCollectionDialog({
  open,
  onClose,
  onCreate,
}: NewCollectionDialogProps) {
  const titleId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (!open) return
    setName('')
    setDescription('')
    const t = window.setTimeout(() => nameRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

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

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate({
      name: trimmed,
      description: description.trim() || undefined,
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-lib-border bg-[#0f172a] p-5 shadow-[0_20px_48px_rgba(0,0,0,0.45)]"
      >
        <h2
          id={titleId}
          className="m-0 mb-1 text-lg font-semibold text-lib-text-strong"
        >
          New collection
        </h2>
        <p className="m-0 mb-4 text-[13px] text-lib-muted">
          Stub dialog — collection stays in this session until persistence lands.
        </p>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1.5 text-[13px] text-lib-muted">
            Name
            <input
              ref={nameRef}
              type="text"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 rounded-lg border border-lib-border bg-lib-input px-3 text-sm text-lib-text-strong outline-none focus:border-lib-accent focus:shadow-[0_0_0_3px_var(--color-lib-accent-soft)]"
              placeholder="e.g. Weekend fiction"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-lib-muted">
            Description <span className="text-lib-faint">(optional)</span>
            <input
              type="text"
              maxLength={160}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-10 rounded-lg border border-lib-border bg-lib-input px-3 text-sm text-lib-text-strong outline-none focus:border-lib-accent focus:shadow-[0_0_0_3px_var(--color-lib-accent-soft)]"
              placeholder="Short note about this set"
            />
          </label>

          <div className="mt-2 flex justify-end gap-2.5">
            <button
              type="button"
              className="inline-flex h-[38px] cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-medium text-lib-muted transition-colors hover:text-lib-text-strong"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex h-[38px] cursor-pointer items-center rounded-lg border-none bg-lib-accent px-4 text-[13px] font-semibold text-lib-bg-deep transition-colors hover:bg-lib-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!name.trim()}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
