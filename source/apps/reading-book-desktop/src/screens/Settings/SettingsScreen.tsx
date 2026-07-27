import { GlobalReadingAppearance, SettingsHeader } from './components'

/** SCR-06 — App Settings (global reading appearance now; more sections in G6). */
export function SettingsScreen() {
  return (
    <div className="lib-chrome flex h-full w-full select-none overflow-hidden font-[system-ui,'Segoe_UI',sans-serif] text-lib-text antialiased">
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="app-titlebar flex h-16 shrink-0 items-center border-b border-lib-border-soft bg-lib-topbar pl-7 backdrop-blur-sm">
          <SettingsHeader />
        </header>
        <div className="app-scroll flex-1 overflow-y-auto px-7 py-8">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
            <GlobalReadingAppearance />
            <p className="m-0 text-sm leading-relaxed text-lib-muted">
              Other app settings (language, file scan, multi-document, linked
              libraries) land in a later phase.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
