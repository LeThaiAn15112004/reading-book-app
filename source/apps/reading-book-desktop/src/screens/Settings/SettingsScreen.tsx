import { AppSidebar } from '../../utils'
import { SettingsBackLink, SettingsHeader } from './components'

/** SCR-06 — App Settings stub (full settings UI in G6; not Reading Settings SCR-05). */
export function SettingsScreen() {
  return (
    <div className="lib-chrome flex h-screen w-full select-none overflow-hidden bg-[radial-gradient(ellipse_80%_50%_at_20%_-10%,rgba(245,158,11,0.08),transparent_55%),radial-gradient(circle_at_80%_100%,rgba(30,58,138,0.18),transparent_45%),radial-gradient(circle,#1e293b_0%,#0f172a_100%)] font-[system-ui,'Segoe_UI',sans-serif] text-lib-text antialiased">
      <AppSidebar activeId="settings" />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center border-b border-lib-border-soft bg-lib-topbar px-7 backdrop-blur-sm">
          <SettingsHeader />
        </header>
        <div className="flex-1 overflow-y-auto px-7 py-8">
          <div className="mx-auto w-full max-w-xl">
            <p className="m-0 mb-6 text-sm leading-relaxed text-lib-muted">
              App-level settings (appearance, language, file scan, multi-document,
              linked libraries) land in a later phase. This is the SCR-06 entry
              point from Library.
            </p>
            <SettingsBackLink />
          </div>
        </div>
      </main>
    </div>
  )
}
