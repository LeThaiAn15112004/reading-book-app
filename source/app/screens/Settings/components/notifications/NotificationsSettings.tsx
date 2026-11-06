import { useEffect } from 'react'
import { useNotificationsStore, type NotificationBlockedReason } from '../../logic/notificationsStore'
import { SettingsCard } from '../layout/SettingsCard'
import { SettingsSwitch } from '../layout/SettingsSwitch'
import { BackgroundTrayCard } from './BackgroundTrayCard'
import { ReadingRemindersCard } from './ReadingRemindersCard'

const BLOCKED_COPY: Record<NotificationBlockedReason, { title: string; body: string }> = {
  unsupported: {
    title: 'Notifications aren’t available',
    body: 'Your system doesn’t allow Readmate Reader to show notifications right now. Check your OS notification settings, then try again.',
  },
  denied: {
    title: 'Notification permission was denied',
    body: 'Allow notifications for Readmate Reader in your system settings, then turn this on again.',
  },
  error: {
    title: 'Couldn’t check notification permission',
    body: 'Please try again in a moment.',
  },
}

/**
 * SCR-06 Settings → Notifications: Notification Permission (master "Enable Notifications"),
 * Reading Reminders, and Background / System Tray. Notification prefs are owned by Main and loaded
 * when this page opens.
 */
export function NotificationsSettings() {
  const prefs = useNotificationsStore((s) => s.prefs)
  const loadFailed = useNotificationsStore((s) => s.loadFailed)
  const checking = useNotificationsStore((s) => s.checking)
  const blocked = useNotificationsStore((s) => s.blocked)
  const saveFailed = useNotificationsStore((s) => s.saveFailed)
  const load = useNotificationsStore((s) => s.load)
  const setEnabled = useNotificationsStore((s) => s.setEnabled)
  const dismissBlocked = useNotificationsStore((s) => s.dismissBlocked)
  const blockedCopy = blocked ? BLOCKED_COPY[blocked] : null

  useEffect(() => {
    void load()
  }, [load])

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

      <SettingsCard title="Notification Permission">
        {prefs ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p id="notifications-enable-label" className="m-0 text-[13px] text-lib-text-strong">
                  Enable Notifications
                </p>
                <p id="notifications-enable-desc" className="m-0 mt-1 text-[12px] text-lib-faint">
                  Cho phép ứng dụng hiển thị thông báo trên hệ thống.
                  {checking ? ' Checking permission…' : null}
                </p>
              </div>
              <SettingsSwitch
                checked={prefs.enabled}
                onChange={(next) => void setEnabled(next)}
                labelledBy="notifications-enable-label"
                describedBy="notifications-enable-desc"
                disabled={checking}
              />
            </div>

            {blockedCopy ? (
              <div
                role="alert"
                className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2.5 text-[13px] text-lib-text-strong"
              >
                <div className="min-w-0">
                  <p className="m-0 font-semibold">{blockedCopy.title}</p>
                  <p className="m-0 mt-0.5 text-[12px] text-lib-muted">{blockedCopy.body}</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 cursor-pointer rounded-md border-none bg-transparent px-1.5 py-0.5 text-[12px] font-semibold text-lib-muted hover:text-lib-text-strong focus-visible:outline-2 focus-visible:outline-lib-accent"
                  onClick={dismissBlocked}
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </>
        ) : (
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
        )}
      </SettingsCard>

      <ReadingRemindersCard />
      <BackgroundTrayCard />
    </div>
  )
}
