import { useEffect, type ReactNode } from 'react'
import { useBackgroundStore } from '../../logic/backgroundStore'
import { SettingsCard } from '../layout/SettingsCard'
import { SettingsSwitch } from '../layout/SettingsSwitch'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
const TRAY_NAME = isMac ? 'menu bar' : 'system tray'

const CARD_TITLE = 'Background / System Tray'

/** One labelled row of the card; rows after the first get a divider. */
function Row({
  labelId,
  descId,
  label,
  description,
  control,
}: {
  labelId: string
  descId: string
  label: string
  description: string
  control: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-lib-border-soft pt-4 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p id={labelId} className="m-0 text-[13px] text-lib-text-strong">
          {label}
        </p>
        <p id={descId} className="m-0 mt-1 text-[12px] text-lib-faint">
          {description}
        </p>
      </div>
      {control}
    </div>
  )
}

/**
 * Settings → Notifications → Background / System Tray: Run in Background, System Tray, Quit from
 * Tray. The switches live in Main (tray + close button); this card loads them on open and every
 * change is saved by Main before it shows here.
 */
export function BackgroundTrayCard() {
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
      <SettingsCard title={CARD_TITLE}>
        <p role={loadFailed ? 'alert' : 'status'} className="m-0 text-[13px] text-lib-muted">
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
        </p>
      </SettingsCard>
    )
  }

  return (
    <SettingsCard title={CARD_TITLE}>
      <div className="flex flex-col gap-4">
        {saveFailed ? (
          <p
            role="alert"
            className="m-0 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-400"
          >
            Couldn’t save this change. The previous setting is still in use.
          </p>
        ) : null}

        <Row
          labelId="background-run-label"
          descId="background-run-desc"
          label="Run in Background"
          description={
            prefs.showTray
              ? `Closing the window hides it instead of quitting, so Readmate keeps running. Reopen it from the ${TRAY_NAME} icon.`
              : `Needs the ${TRAY_NAME} icon below — it’s how you reopen or quit Readmate while it runs in the background.`
          }
          control={
            <SettingsSwitch
              checked={prefs.runInBackground}
              onChange={(next) => void setRunInBackground(next)}
              labelledBy="background-run-label"
              describedBy="background-run-desc"
              disabled={saving || !prefs.showTray}
            />
          }
        />

        <Row
          labelId="background-tray-label"
          descId="background-tray-desc"
          label="System Tray"
          description={`Show a Readmate icon in the ${TRAY_NAME}. ${
            isMac ? 'Click' : 'Click to open Readmate; right-click'
          } for Open Readmate and Quit Readmate.`}
          control={
            <SettingsSwitch
              checked={prefs.showTray}
              onChange={(next) => void setShowTray(next)}
              labelledBy="background-tray-label"
              describedBy="background-tray-desc"
              disabled={saving}
            />
          }
        />

        <Row
          labelId="background-quit-label"
          descId="background-quit-desc"
          label="Quit from Tray"
          description={`Quit Readmate in the ${TRAY_NAME} menu closes the app completely, even while it runs in the background. Your reading position is saved first. You can also quit right here.`}
          control={
            <button
              type="button"
              aria-describedby="background-quit-desc"
              className="inline-flex h-9 shrink-0 cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-text-strong transition-colors hover:border-red-400 hover:text-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-wait disabled:opacity-60"
              disabled={quitting}
              aria-busy={quitting}
              onClick={() => void quit()}
            >
              {quitting ? 'Quitting…' : 'Quit Readmate'}
            </button>
          }
        />
      </div>
    </SettingsCard>
  )
}
