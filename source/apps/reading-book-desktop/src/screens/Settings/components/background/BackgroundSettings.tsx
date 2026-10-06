import { useEffect } from 'react'
import { useBackgroundStore } from '../../logic/backgroundStore'
import { SettingsCard } from '../layout/SettingsCard'
import { SettingsSwitch } from '../layout/SettingsSwitch'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
const TRAY_NAME = isMac ? 'menu bar' : 'system tray'

/**
 * SCR-06 Settings → Background & System Tray. The switches live in Main (tray + close button);
 * this screen loads them on open and every change is saved by Main before it shows here.
 */
export function BackgroundSettings() {
  const prefs = useBackgroundStore((s) => s.prefs)
  const loadFailed = useBackgroundStore((s) => s.loadFailed)
  const saving = useBackgroundStore((s) => s.saving)
  const saveFailed = useBackgroundStore((s) => s.saveFailed)
  const quitting = useBackgroundStore((s) => s.quitting)
  const load = useBackgroundStore((s) => s.load)
  const setShowTray = useBackgroundStore((s) => s.setShowTray)
  const setRunInBackground = useBackgroundStore((s) => s.setRunInBackground)
  const quit = useBackgroundStore((s) => s.quit)

  useEffect(() => {
    void load()
  }, [load])

  if (!prefs) {
    return (
      <div
        role={loadFailed ? 'alert' : 'status'}
        className="rounded-xl border border-lib-border-soft p-[var(--ui-density-pad)] text-[13px] text-lib-muted"
      >
        {loadFailed ? (
          <>
            Couldn’t load these settings.{' '}
            <button
              type="button"
              className="cursor-pointer border-none bg-transparent p-0 font-semibold text-lib-accent underline"
              onClick={() => void load()}
            >
              Try again
            </button>
          </>
        ) : (
          'Loading…'
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[var(--ui-density-gap)]">
      {saveFailed ? (
        <p
          role="alert"
          className="m-0 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-400"
        >
          Couldn’t save this change. The previous setting is still in use.
        </p>
      ) : null}

      <SettingsCard title="System Tray">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p id="background-tray-label" className="m-0 text-[13px] text-lib-text-strong">
              Show icon in the {TRAY_NAME}
            </p>
            <p id="background-tray-desc" className="m-0 mt-1 text-[12px] text-lib-faint">
              A Readmate icon in the {TRAY_NAME}. Its menu has Open Readmate and Quit Readmate.
            </p>
          </div>
          <SettingsSwitch
            checked={prefs.showTray}
            onChange={(next) => void setShowTray(next)}
            labelledBy="background-tray-label"
            describedBy="background-tray-desc"
            disabled={saving}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Run in Background">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p id="background-run-label" className="m-0 text-[13px] text-lib-text-strong">
              Keep running when the window is closed
            </p>
            <p id="background-run-desc" className="m-0 mt-1 text-[12px] text-lib-faint">
              {prefs.showTray
                ? `Closing the window hides it instead of quitting. Reopen it from the ${TRAY_NAME} icon, or quit there.`
                : `Turn on the ${TRAY_NAME} icon first — it’s how you reopen or quit Readmate while it runs in the background.`}
            </p>
          </div>
          <SettingsSwitch
            checked={prefs.runInBackground}
            onChange={(next) => void setRunInBackground(next)}
            labelledBy="background-run-label"
            describedBy="background-run-desc"
            disabled={saving || !prefs.showTray}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Quit Readmate"
        description="Quits the app completely, even while it runs in the background — the same as Quit Readmate in the tray menu. Your reading position is saved first."
      >
        <button
          type="button"
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-text-strong transition-colors hover:border-red-400 hover:text-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-wait disabled:opacity-60"
          disabled={quitting}
          aria-busy={quitting}
          onClick={() => void quit()}
        >
          {quitting ? 'Quitting…' : 'Quit Readmate'}
        </button>
      </SettingsCard>
    </div>
  )
}
