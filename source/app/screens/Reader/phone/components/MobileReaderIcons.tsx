/**
 * The phone reader's icons (spec 019, FR-016, research R12): inline SVG in the app's icon style (24 × 24 viewBox,
 * stroke 1.8, round caps — as `PhoneNav` / `LibraryIcons`). Always `aria-hidden`: the button around an icon carries
 * the accessible name. No text glyph is used as an icon in the phone reader.
 */
import type { ReactNode } from 'react'

export type MobileReaderIconName =
  | 'back'
  | 'bookmark'
  | 'bookmarkFilled'
  | 'contents'
  | 'notes'
  | 'appearance'
  | 'previous'
  | 'next'
  | 'zoomIn'
  | 'zoomOut'
  | 'fit'
  | 'check'
  | 'underline'
  | 'strike'
  | 'note'
  | 'copy'
  | 'close'
  | 'delete'
  | 'minus'
  | 'plus'
  | 'edit'

const PATHS: Record<MobileReaderIconName, ReactNode> = {
  back: <path d="M15 5l-7 7 7 7" />,
  bookmark: <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" />,
  bookmarkFilled: <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" fill="currentColor" />,
  contents: (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" strokeWidth="2.6" />
    </>
  ),
  notes: (
    <>
      <path d="M5 4h14v12l-4 4H5z" />
      <path d="M15 20v-4h4M8.5 9h7M8.5 12.5h4" />
    </>
  ),
  appearance: (
    <>
      <path d="M3.5 19 8.5 6l5 13M5.3 14.5h6.4" />
      <path d="M15.5 19v-5.5a2.75 2.75 0 0 1 5.5 0V19M15.5 16h5.5" />
    </>
  ),
  previous: <path d="M15 5l-7 7 7 7" />,
  next: <path d="M9 5l7 7-7 7" />,
  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.8-4.8M10.5 7.5v6M7.5 10.5h6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.8-4.8M7.5 10.5h6" />
    </>
  ),
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  underline: <path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" />,
  strike: <path d="M16.5 6.5A4.5 3.5 0 0 0 12 4c-2.5 0-4.5 1.4-4.5 3.4 0 4.1 9.5 3 9.5 8 0 2-2 3.6-5 3.6a5 4 0 0 1-5-2.6M4 12h16" />,
  note: (
    <>
      <path d="M5 5h14v10H10l-5 4z" />
      <path d="M9 9.5h6" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  delete: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
}

export function MobileReaderIcon({ name, size = 22, className }: { name: MobileReaderIconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
