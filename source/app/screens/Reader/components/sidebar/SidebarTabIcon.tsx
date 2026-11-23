import type { SidebarTab } from './TocSidebar'

/**
 * Spec 018 FR-013: the rail's tab icons — vector outlines in the toolbar's style (24 viewBox, stroke 1.8,
 * `currentColor`), so they follow the theme and look the same on every system. Shared by the text reader and the
 * audiobook player. Decorative: the rail button carries the translated name.
 */
const PATHS: Record<SidebarTab, readonly string[]> = {
  // A list: Contents.
  chapters: ['M8.25 6.75h12M8.25 12h12M8.25 17.25h12', 'M3.75 6.75h.008v.008H3.75V6.75Z', 'M3.75 12h.008v.008H3.75V12Z', 'M3.75 17.25h.008v.008H3.75v-.008Z'],
  bookmarks: [
    'M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z',
  ],
  // A marker pen: highlights / Notes.
  highlights: [
    'm16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z',
    'M16.862 4.487 19.5 7.125',
    'M3.75 21h16.5',
  ],
  // Two pages side by side: Page layout.
  layout: ['M3.75 5.25h7.5v13.5h-7.5z', 'M12.75 5.25h7.5v13.5h-7.5z'],
  attachments: [
    'm18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13',
  ],
  // A speech bubble with lines: Transcript.
  transcript: [
    'M7.5 8.25h9m-9 3H12',
    'M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z',
  ],
}

export function SidebarTabIcon({ tab, className = 'size-[18px]' }: { tab: SidebarTab; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[tab].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
