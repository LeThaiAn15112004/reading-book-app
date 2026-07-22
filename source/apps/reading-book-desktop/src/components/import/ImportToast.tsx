import { useEffect } from 'react'

export type ImportToastVariant = 'success' | 'error' | 'info'

export type ImportToastProps = {
  open: boolean
  message: string
  variant?: ImportToastVariant
  /** Auto-hide delay in ms; default 2800. */
  durationMs?: number
  onClose: () => void
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m4.5 12.75 6 6 9-13.5"
      />
    </svg>
  )
}

/**
 * UX-IMP toast — success (T2.11) and short error/info notices.
 */
export function ImportToast({
  open,
  message,
  variant = 'info',
  durationMs = 2800,
  onClose,
}: ImportToastProps) {
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(onClose, durationMs)
    return () => window.clearTimeout(id)
  }, [open, durationMs, onClose, message])

  if (!open) return null

  const iconClass =
    variant === 'error'
      ? 'text-red-400'
      : variant === 'success'
        ? 'text-lib-accent'
        : 'text-lib-muted'

  return (
    <div
      className="pointer-events-none absolute right-6 bottom-6 z-40 flex max-w-[360px] items-center gap-3 rounded-lg border border-lib-accent-ring bg-lib-bg-mid px-[18px] py-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.35)] animate-import-toast-in"
      role="status"
      aria-live="polite"
    >
      {variant === 'success' ? (
        <CheckIcon className={`size-5 shrink-0 ${iconClass}`} />
      ) : (
        <span
          className={`size-2 shrink-0 rounded-full ${
            variant === 'error' ? 'bg-red-400' : 'bg-lib-muted'
          }`}
          aria-hidden
        />
      )}
      <p className="m-0 text-[13px] font-medium text-lib-text-strong">{message}</p>
    </div>
  )
}
