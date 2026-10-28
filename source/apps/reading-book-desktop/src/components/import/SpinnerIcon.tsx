/** A small rotating ring (the "working" indicator on the Audiobook ZIP entry and in its panel). */
export function SpinnerIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={3}
      stroke="currentColor"
      className={`animate-spin ${className}`}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path strokeLinecap="round" d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  )
}
