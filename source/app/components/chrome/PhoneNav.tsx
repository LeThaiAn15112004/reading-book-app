import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useT } from '../../i18n'
import { flushRegisteredSession } from '../../screens/Reader/logic'
import { usePhoneSettingsNavStore } from '../../screens/Settings/logic/phoneSettingsNavStore'
import { useAppNav, type AppNavId } from './AppNavContext'

type NavIconProps = { className?: string }

/**
 * The three tabs of the phone bar (a subset of `AppNavId`). No Reading tab: a book is opened from the Library
 * (Continue Reading) and the Reader is full screen with its own back button.
 */
type PhoneTabId = Extract<AppNavId, 'library' | 'collections' | 'settings'>

/** Inline icons of the tab bar (decorative: the label is the button's name). */
const NAV_ICONS: Record<PhoneTabId, (props: NavIconProps) => ReactNode> = {
  library: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
    </svg>
  ),
  collections: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  ),
  // "More" (spec 014 FR-018): three dots in a rounded square — the tab opens the settings sections list.
  settings: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" strokeWidth="2.6" />
    </svg>
  ),
}

/**
 * Bottom tab bar of the Mobile host (spec 008, T070; spec 013 US5; `contracts/phone-ui.md`): shown instead of
 * `AppTitlebar` and `AppMenubar`, which are desktop window chrome, and rendered AFTER the content (`App.tsx`) so it
 * stays fixed while a screen scrolls. Opaque `bg-lib-bg-deep`, so the system navigation area — painted from the
 * page's bottom edge by `platforms/window-system-bars.ts` — takes the same colour (FR-028). Same destinations and the same calls as `AppMenubar` (the session is
 * flushed before leaving the Reader); Cloud Sources is not in the first release. Targets are at least 44 px.
 */
export function PhoneNav() {
  const t = useT()
  const location = useLocation()
  const navigate = useNavigate()
  const { libraryNav } = useAppNav()

  const path = location.pathname
  if (path === '/') return null
  // The Mobile Reader is full screen with its own top bar (back to Library), like other phone reading apps (T102).
  if (path.startsWith('/reader')) return null

  const onReading = path.startsWith('/reader')
  const activeId: AppNavId = path.startsWith('/settings') ? 'settings' : onReading ? 'reading' : (libraryNav?.activeId ?? 'library')

  function leaveReaderThen(run: () => void) {
    void (async () => {
      if (onReading) await flushRegisteredSession()
      run()
    })()
  }

  const items: { id: PhoneTabId; label: string; onSelect: () => void; badge?: number; disabled?: boolean }[] = [
    { id: 'library', label: t('chrome.nav.library'), onSelect: () => leaveReaderThen(() => (libraryNav ? libraryNav.onLibraryNav() : navigate('/library'))) },
    {
      id: 'collections',
      label: t('chrome.nav.collections'),
      onSelect: () => leaveReaderThen(() => (libraryNav ? libraryNav.onStubNav('collections') : navigate('/library', { state: { openNav: 'collections' } }))),
    },
    {
      id: 'settings',
      label: t('chrome.nav.settings'),
      // Always the section list (spec 014 FR-006): from another tab the list starts at the top; tapping the tab while
      // already in More replaces the entry, so Back does not return to an abandoned section page.
      onSelect: () =>
        leaveReaderThen(() => {
          const inMore = path.startsWith('/settings')
          if (!inMore) usePhoneSettingsNavStore.getState().resetListScroll()
          navigate('/settings', { replace: inMore })
        }),
    },
  ]

  return (
    <nav
      className="phone-nav flex shrink-0 items-stretch justify-around border-t border-lib-border-soft bg-lib-bg-deep px-1"
      aria-label={t('chrome.nav.mainNavigation')}
    >
      {items.map((item) => {
        const active = item.id === activeId
        const Icon = NAV_ICONS[item.id]
        return (
          <button
            key={item.id}
            type="button"
            className={`inline-flex min-h-14 min-w-11 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 border-none bg-transparent px-1 py-1.5 text-[11px] font-medium disabled:opacity-40 ${
              active ? 'text-lib-accent' : 'text-lib-muted'
            }`}
            aria-current={active ? 'page' : undefined}
            disabled={item.disabled}
            onClick={item.onSelect}
          >
            <span className="relative inline-flex">
              <Icon className="size-6" />
              {item.badge ? (
                <span className="absolute -top-1 left-full -ml-2 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-lib-accent-soft px-1 text-[10px] leading-4 font-bold text-lib-accent">
                  {item.badge}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
