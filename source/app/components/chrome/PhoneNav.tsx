import { useLocation, useNavigate } from 'react-router-dom'
import { flushRegisteredSession } from '../../screens/Reader/logic'
import { useAppNav, type AppNavId } from './AppNavContext'
import { useOpenReading } from './OpenReadingContext'

/**
 * Compact navigation for the Mobile host (spec 008, T070; `contracts/phone-ui.md`): shown instead of `AppTitlebar` and
 * `AppMenubar`, which are desktop window chrome. Same destinations and the same calls as `AppMenubar` (the session is
 * flushed before leaving the Reader); Cloud Sources is not in the first release. Targets are at least 44 px.
 */
export function PhoneNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { libraryNav } = useAppNav()
  const { tabs, goReading } = useOpenReading()

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

  const items: { id: AppNavId; label: string; onSelect: () => void; badge?: number; disabled?: boolean }[] = [
    { id: 'library', label: 'Library', onSelect: () => leaveReaderThen(() => (libraryNav ? libraryNav.onLibraryNav() : navigate('/library'))) },
    {
      id: 'collections',
      label: 'Collections',
      onSelect: () => leaveReaderThen(() => (libraryNav ? libraryNav.onStubNav('collections') : navigate('/library', { state: { openNav: 'collections' } }))),
    },
    { id: 'reading', label: 'Reading', onSelect: () => goReading(), badge: tabs.length, disabled: tabs.length === 0 },
    { id: 'settings', label: 'Settings', onSelect: () => leaveReaderThen(() => navigate('/settings')) },
  ]

  return (
    <nav
      className="phone-nav flex items-stretch justify-around border-b border-lib-border-soft bg-lib-bg-deep/95 px-1 backdrop-blur-md"
      aria-label="Main navigation"
    >
      {items.map((item) => {
        const active = item.id === activeId
        return (
          <button
            key={item.id}
            type="button"
            className={`inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1 border-none bg-transparent px-2 text-[13px] font-medium disabled:opacity-40 ${
              active ? 'text-lib-accent' : 'text-lib-muted'
            }`}
            aria-current={active ? 'page' : undefined}
            disabled={item.disabled}
            onClick={item.onSelect}
          >
            {item.label}
            {item.badge ? (
              <span className="inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-lib-accent-soft px-1 text-[10px] font-bold text-lib-accent">
                {item.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}
