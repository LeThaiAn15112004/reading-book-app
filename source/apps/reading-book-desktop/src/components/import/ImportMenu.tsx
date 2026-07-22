import { useEffect, useId, useRef, useState } from 'react'

export type ImportMenuProps = {
  onFromDevice: () => void
  onFromUrl: () => void
  /** md = top bar; lg = empty-state CTA cluster */
  size?: 'md' | 'lg'
}

/** Matches Tailwind `sm` — below this, collapse to Import dropdown. */
const WIDE_MQ = '(min-width: 640px)'

function PlusIcon({ className }: { className?: string }) {
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
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
      />
    </svg>
  )
}

function DeviceIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25"
      />
    </svg>
  )
}

function ChevronIcon({ className }: { className?: string }) {
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
        d="m19.5 8.25-7.5 7.5-7.5-7.5"
      />
    </svg>
  )
}

/**
 * UX-IMP entry — responsive:
 * - wide (≥640px): separate Add file + Import URL
 * - narrow: single Import control + dropdown
 */
export function ImportMenu({
  onFromDevice,
  onFromUrl,
  size = 'md',
}: ImportMenuProps) {
  const isLg = size === 'lg'
  const iconClass = isLg ? 'size-5' : 'size-4'

  const primaryClass = isLg
    ? 'inline-flex h-12 cursor-pointer items-center gap-2.5 rounded-xl border-none bg-lib-accent px-7 text-[15px] font-semibold text-lib-bg-deep shadow-[0_6px_20px_rgba(245,158,11,0.28)] transition-colors hover:bg-lib-accent-hover'
    : 'inline-flex h-[38px] shrink-0 cursor-pointer items-center gap-2 rounded-lg border-none bg-lib-accent px-4 text-[13px] font-semibold text-lib-bg-deep shadow-[0_4px_14px_rgba(245,158,11,0.22)] transition-colors hover:bg-lib-accent-hover'

  const secondaryClass = isLg
    ? 'inline-flex h-12 cursor-pointer items-center gap-2.5 rounded-xl border border-lib-border bg-transparent px-7 text-[15px] font-semibold text-lib-text-strong transition-colors hover:border-lib-accent hover:bg-lib-accent-soft'
    : 'inline-flex h-[38px] shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-text-strong transition-colors hover:border-lib-accent hover:bg-lib-accent-soft'

  return (
    <div className="inline-flex shrink-0" aria-label="Import documents">
      {/* Narrow viewport — Import dropdown */}
      <div className="sm:hidden">
        <ImportDropdown
          onFromDevice={onFromDevice}
          onFromUrl={onFromUrl}
          size={size}
        />
      </div>

      {/* Wide viewport — two buttons */}
      <div
        className={`hidden sm:inline-flex items-center ${isLg ? 'flex-wrap justify-center gap-3' : 'gap-2'}`}
        role="group"
        aria-label="Import documents"
      >
        <button
          type="button"
          className={primaryClass}
          aria-label="Add file from this device"
          onClick={onFromDevice}
        >
          <PlusIcon className={iconClass} />
          <span>Add file</span>
        </button>
        <button
          type="button"
          className={secondaryClass}
          aria-label="Import document from URL"
          onClick={onFromUrl}
        >
          <LinkIcon className={iconClass} />
          <span>Import URL</span>
        </button>
      </div>
    </div>
  )
}

function ImportDropdown({
  onFromDevice,
  onFromUrl,
  size,
}: {
  onFromDevice: () => void
  onFromUrl: () => void
  size: 'md' | 'lg'
}) {
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const isLg = size === 'lg'

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Close menu when viewport expands past the narrow breakpoint.
  useEffect(() => {
    const mq = window.matchMedia(WIDE_MQ)
    function onChange(e: MediaQueryListEvent) {
      if (e.matches) setOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  function choose(action: () => void) {
    setOpen(false)
    action()
  }

  const triggerClass = isLg
    ? 'inline-flex h-12 cursor-pointer items-center gap-2.5 rounded-xl border-none bg-lib-accent px-7 text-[15px] font-semibold text-lib-bg-deep shadow-[0_6px_20px_rgba(245,158,11,0.28)] transition-colors hover:bg-lib-accent-hover'
    : 'inline-flex h-[38px] shrink-0 cursor-pointer items-center gap-2 rounded-lg border-none bg-lib-accent px-4 text-[13px] font-semibold text-lib-bg-deep shadow-[0_4px_14px_rgba(245,158,11,0.22)] transition-colors hover:bg-lib-accent-hover'

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        className={triggerClass}
        aria-label="Import"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <PlusIcon className={isLg ? 'size-5' : 'size-4'} />
        <span>Import</span>
        <ChevronIcon className={isLg ? 'size-4' : 'size-3.5'} />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Import options"
          className="absolute top-[calc(100%+6px)] right-0 z-[100] flex w-[190px] flex-col gap-1 rounded-lg border border-lib-border bg-lib-surface-strong p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-md"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border-none bg-transparent px-3 py-2.5 text-left text-[13px] text-lib-text transition-colors hover:bg-white/5 hover:text-lib-text-strong [&_svg]:text-lib-muted hover:[&_svg]:text-lib-accent"
            onClick={() => choose(onFromDevice)}
          >
            <DeviceIcon className="size-4" />
            <span>Add file</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border-none bg-transparent px-3 py-2.5 text-left text-[13px] text-lib-text transition-colors hover:bg-white/5 hover:text-lib-text-strong [&_svg]:text-lib-muted hover:[&_svg]:text-lib-accent"
            onClick={() => choose(onFromUrl)}
          >
            <LinkIcon className="size-4" />
            <span>Import URL</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
