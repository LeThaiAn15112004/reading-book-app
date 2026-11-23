import type { MessageKey } from '@core'
import { useT } from '../../../../i18n'
import { useEffect, type ReactNode } from 'react'
import { canChangeStartAtLogin, useBackgroundStore } from '../../logic/backgroundStore'
import { useMiniPlayerPrefsStore } from '../../logic/miniPlayerPrefsStore'
import { isFeatureAvailable } from '../../../../platforms/host'
import { SettingsCard } from '../layout/SettingsCard'
import { SettingsSwitch } from '../layout/SettingsSwitch'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
const TRAY_NAME_KEY: MessageKey = isMac
  ? 'settings.notifications.background.trayNameMac'
  : 'settings.notifications.background.trayNameWin'

/**
 * Spec 010: why the Store build's Start at Login switch can't be changed here, or null when it can. The startup task
 * is Windows' to decide in these states; the app never overrides it (FR-007).
 */
function startAtLoginLockedReason(state: string | undefined): MessageKey | null {
  switch (state) {
    case 'disabledByUser':
      return 'settings.notifications.background.lockedByUser'
    case 'disabledByPolicy':
    case 'enabledByPolicy':
      return 'settings.notifications.background.lockedByPolicy'
    case 'managedByWindows':
      return 'settings.notifications.background.lockedByWindows'
    default:
      return null
  }
}

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
 * Settings → Notifications → Background / System Tray: Run in Background, System Tray, Start at
 * Login, Quit from Tray. The switches live in Main (tray + close button); this card loads them on open and every
 * change is saved by Main before it shows here.
 */
export function BackgroundTrayCard() {
  const t = useT()
  const tray = t(TRAY_NAME_KEY)
  const CARD_TITLE = t('settings.notifications.background.title')
  const prefs = useBackgroundStore((s) => s.prefs)
  const loadFailed = useBackgroundStore((s) => s.loadFailed)
  const saving = useBackgroundStore((s) => s.saving)
  const saveFailed = useBackgroundStore((s) => s.saveFailed)
  const quitting = useBackgroundStore((s) => s.quitting)
  const load = useBackgroundStore((s) => s.load)
  const setShowTray = useBackgroundStore((s) => s.setShowTray)
  const setRunInBackground = useBackgroundStore((s) => s.setRunInBackground)
  const quit = useBackgroundStore((s) => s.quit)
  const startAtLogin = useBackgroundStore((s) => s.startAtLogin)
  const savingStartAtLogin = useBackgroundStore((s) => s.savingStartAtLogin)
  const startAtLoginFailed = useBackgroundStore((s) => s.startAtLoginFailed)
  const setStartAtLogin = useBackgroundStore((s) => s.setStartAtLogin)
  const refreshStartAtLogin = useBackgroundStore((s) => s.refreshStartAtLogin)
  const openStartupSettings = useBackgroundStore((s) => s.openStartupSettings)

  const floatingAutoOpen = useMiniPlayerPrefsStore((s) => s.autoOpen)
  const floatingSaving = useMiniPlayerPrefsStore((s) => s.saving)
  const floatingFailed = useMiniPlayerPrefsStore((s) => s.failed)
  const loadFloating = useMiniPlayerPrefsStore((s) => s.load)
  const setFloatingAutoOpen = useMiniPlayerPrefsStore((s) => s.setAutoOpen)
  const hasMiniPlayer = isFeatureAvailable('miniPlayer')

  useEffect(() => {
    void load()
    if (hasMiniPlayer) void loadFloating()
  }, [load, loadFloating, hasMiniPlayer])

  // Start at Login can be changed outside the app (Windows Settings → Startup, the login items): read it again when
  // the window comes back to the front.
  useEffect(() => {
    const onFocus = () => void refreshStartAtLogin()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshStartAtLogin])

  const loginLockedReason = startAtLogin?.supported ? startAtLoginLockedReason(startAtLogin.state) : null
  const loginCanChange = canChangeStartAtLogin(startAtLogin)

  if (!prefs) {
    return (
      <SettingsCard title={CARD_TITLE}>
        <p role={loadFailed ? 'alert' : 'status'} className="m-0 text-[13px] text-lib-muted">
          {loadFailed ? (
            <>
              {t('settings.loadFailed')}{' '}
              <button
                type="button"
                className="cursor-pointer border-none bg-transparent p-0 font-semibold text-lib-accent underline"
                onClick={() => void load()}
              >
                {t('settings.tryAgain')}
              </button>
            </>
          ) : (
            t('settings.loading')
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
            {t('settings.saveFailed')}
          </p>
        ) : null}

        <Row
          labelId="background-run-label"
          descId="background-run-desc"
          label={t('settings.notifications.background.run')}
          description={
            prefs.showTray
              ? t('settings.notifications.background.runOn', { tray })
              : t('settings.notifications.background.runOff', { tray })
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
          label={t('settings.notifications.background.tray')}
          description={
            isMac
              ? t('settings.notifications.background.trayDescriptionMac', { tray })
              : t('settings.notifications.background.trayDescription', { tray })
          }
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

        {hasMiniPlayer && floatingAutoOpen !== null ? (
          <Row
            labelId="background-floating-label"
            descId="background-floating-desc"
            label={t('settings.notifications.background.floatingPlayer')}
            description={
              floatingFailed
                ? t('settings.saveFailed')
                : t('settings.notifications.background.floatingPlayerDescription')
            }
            control={
              <SettingsSwitch
                checked={floatingAutoOpen}
                onChange={(next) => void setFloatingAutoOpen(next)}
                labelledBy="background-floating-label"
                describedBy="background-floating-desc"
                disabled={floatingSaving}
              />
            }
          />
        ) : null}

        <Row
          labelId="background-login-label"
          descId="background-login-desc"
          label={t('settings.notifications.background.login')}
          description={
            !startAtLogin?.supported
              ? t('settings.notifications.background.loginUnavailable')
              : loginLockedReason
                ? t(loginLockedReason)
                : startAtLoginFailed
                  ? t('settings.notifications.background.loginFailed')
                  : prefs.showTray
                    ? t('settings.notifications.background.loginOnTray', { tray })
                    : t('settings.notifications.background.loginNoTray', { tray })
          }
          control={
            <div className="flex shrink-0 flex-col items-end gap-2">
              <SettingsSwitch
                checked={startAtLogin?.enabled ?? false}
                onChange={(next) => void setStartAtLogin(next)}
                labelledBy="background-login-label"
                describedBy="background-login-desc"
                disabled={!loginCanChange || savingStartAtLogin}
              />
              {loginLockedReason ? (
                <button
                  type="button"
                  className="cursor-pointer border-none bg-transparent p-0 text-[12px] font-semibold text-lib-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent"
                  onClick={() => void openStartupSettings()}
                >
                  {t('settings.notifications.background.openStartup')}
                </button>
              ) : null}
            </div>
          }
        />

        <Row
          labelId="background-quit-label"
          descId="background-quit-desc"
          label={t('settings.notifications.background.quit')}
          description={t('settings.notifications.background.quitDescription', { tray })}
          control={
            <button
              type="button"
              aria-describedby="background-quit-desc"
              className="inline-flex h-9 shrink-0 cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-text-strong transition-colors hover:border-red-400 hover:text-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-wait disabled:opacity-60"
              disabled={quitting}
              aria-busy={quitting}
              onClick={() => void quit()}
            >
              {quitting ? t('settings.notifications.background.quitting') : t('settings.notifications.background.quitButton')}
            </button>
          }
        />
      </div>
    </SettingsCard>
  )
}
