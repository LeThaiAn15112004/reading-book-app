/**
 * Spec 018: the audiobook player's symbols, shared by the full player, the mini player bar and the floating window
 * (one icon style: 24 viewBox, `currentColor`). All decorative — the buttons carry translated names.
 */

type IconProps = { className?: string }

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function PlayIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M7 4.5v15l12.5-7.5L7 4.5Z" fill="currentColor" />
    </svg>
  )
}

export function PauseIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="6" y="4.5" width="4.25" height="15" rx="1" fill="currentColor" />
      <rect x="13.75" y="4.5" width="4.25" height="15" rx="1" fill="currentColor" />
    </svg>
  )
}

/** A circular arrow turning back, with the number of seconds inside (spec 018 FR-014). */
export function SkipBackIcon({ seconds, className = 'size-7' }: IconProps & { seconds: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path {...stroke} d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path {...stroke} d="M4.5 3.75v3.5H8" />
      <text x="12.4" y="15.4" textAnchor="middle" fontSize="7.2" fontWeight="700" fill="currentColor">
        {seconds}
      </text>
    </svg>
  )
}

export function SkipForwardIcon({ seconds, className = 'size-7' }: IconProps & { seconds: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path {...stroke} d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path {...stroke} d="M19.5 3.75v3.5H16" />
      <text x="11.6" y="15.4" textAnchor="middle" fontSize="7.2" fontWeight="700" fill="currentColor">
        {seconds}
      </text>
    </svg>
  )
}

export function PreviousIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="4.5" y="5" width="2.5" height="14" rx="0.75" fill="currentColor" />
      <path d="M19.5 5v14L8.5 12l11-7Z" fill="currentColor" />
    </svg>
  )
}

export function NextIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="17" y="5" width="2.5" height="14" rx="0.75" fill="currentColor" />
      <path d="M4.5 5v14l11-7-11-7Z" fill="currentColor" />
    </svg>
  )
}

export function SpeakerIcon({ muted, className = 'size-4' }: IconProps & { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path {...stroke} d="M4.5 9.25h3l4.5-3.75v13L7.5 14.75h-3v-5.5Z" />
      {muted ? (
        <path {...stroke} d="m16 9.5 5 5m0-5-5 5" />
      ) : (
        <path {...stroke} d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
      )}
    </svg>
  )
}

/** A window with an arrow out of it: "Pop out" into the floating window. */
export function PopOutIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path {...stroke} d="M13.5 4.5h6v6M19.5 4.5 12 12" />
      <path {...stroke} d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </svg>
  )
}

/** An arrow back into a window: "Return to app". */
export function ReturnIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path {...stroke} d="M9 15 4.5 10.5 9 6" />
      <path {...stroke} d="M4.5 10.5h9.75a5.25 5.25 0 0 1 0 10.5H12" />
    </svg>
  )
}

export function MinimizeIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path {...stroke} d="M5.5 17.5h13" />
    </svg>
  )
}

export function CloseIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path {...stroke} d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function WarningIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path {...stroke} d="M12 9v3.75m0 3.75h.008v.008H12v-.008Z" />
      <path {...stroke} d="M10.34 3.94 2.6 17.25A1.95 1.95 0 0 0 4.27 20.2h15.46a1.95 1.95 0 0 0 1.67-2.95L13.66 3.94a1.92 1.92 0 0 0-3.32 0Z" />
    </svg>
  )
}
