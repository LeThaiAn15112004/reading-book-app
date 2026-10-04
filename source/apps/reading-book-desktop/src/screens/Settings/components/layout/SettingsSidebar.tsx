import {
  SETTINGS_SECTIONS,
  useSettingsNavStore,
} from '../../logic/settingsNavStore'
import { SettingsSectionIcon } from './SettingsSectionIcon'

/** Same chevron paths as the Reader sidebar edge handle (`SidebarEdgeRail`). */
function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className="size-3.5"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.2}
      stroke="currentColor"
      aria-hidden
    >
      {collapsed ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
      )}
    </svg>
  )
}

/**
 * SCR-06 Settings navigation. Expanded: icon + label; collapsed: icon only (native tooltip via
 * `title`, name via `aria-label`). Toggled by a full-height edge handle on the sidebar's right
 * edge, like the Reader's left sidebar. Width animates; the content panel takes the rest.
 */
export function SettingsSidebar() {
  const activeSection = useSettingsNavStore((s) => s.activeSection)
  const collapsed = useSettingsNavStore((s) => s.collapsed)
  const setActiveSection = useSettingsNavStore((s) => s.setActiveSection)
  const toggleCollapsed = useSettingsNavStore((s) => s.toggleCollapsed)
  const toggleLabel = collapsed ? 'Expand settings sidebar' : 'Collapse settings sidebar'

  return (
    <div className="relative z-[5] flex shrink-0">
      <aside
        className={`flex shrink-0 flex-col overflow-hidden border-r border-lib-border-soft bg-lib-topbar transition-[width] duration-200 ease-out ${
          collapsed ? 'w-[60px]' : 'w-[232px]'
        }`}
        aria-label="Settings sections"
      >
        <div
          className={`flex h-16 shrink-0 items-center border-b border-lib-border-soft ${
            collapsed ? 'justify-center px-2' : 'pl-5'
          }`}
        >
          <h1
            className={
              collapsed
                ? 'sr-only'
                : 'm-0 truncate text-lg font-semibold tracking-tight text-lib-text-strong'
            }
          >
            Settings
          </h1>
        </div>

        <nav className="app-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2">
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {SETTINGS_SECTIONS.map((section) => {
              const active = section.id === activeSection
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    className={`relative flex h-[var(--ui-density-row)] w-full cursor-pointer items-center gap-3 rounded-lg border-none text-left text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent ${
                      collapsed ? 'justify-center px-0' : 'px-3'
                    } ${
                      active
                        ? 'bg-lib-accent-soft text-lib-accent'
                        : 'bg-transparent text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong'
                    }`}
                    title={collapsed ? section.label : undefined}
                    aria-label={section.label}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setActiveSection(section.id)}
                  >
                    {active ? (
                      <span
                        className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-lib-accent"
                        aria-hidden
                      />
                    ) : null}
                    <SettingsSectionIcon section={section.id} />
                    {collapsed ? null : <span className="min-w-0 truncate">{section.label}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>

      <button
        type="button"
        className="absolute top-0 bottom-0 left-full flex w-5 cursor-pointer items-center justify-center rounded-r-md border border-l-0 border-lib-border-soft bg-lib-surface-strong text-lib-muted shadow-md transition-colors hover:border-lib-accent-ring hover:text-lib-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent"
        title={toggleLabel}
        aria-label={toggleLabel}
        aria-expanded={!collapsed}
        onClick={toggleCollapsed}
      >
        <ChevronIcon collapsed={collapsed} />
      </button>
    </div>
  )
}
