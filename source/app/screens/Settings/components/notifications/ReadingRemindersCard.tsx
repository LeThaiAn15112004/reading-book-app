import type { MessageKey } from '@core'
import { useT } from '../../../../i18n'
import { useEffect, useState } from 'react'
import { useNotificationsStore, type TestReminderState } from '../../logic/notificationsStore'
import { SettingsCard } from '../layout/SettingsCard'
import { SettingsSwitch } from '../layout/SettingsSwitch'

const TEST_STATUS: Partial<Record<TestReminderState, { text: MessageKey; error: boolean }>> = {
  sent: { text: 'settings.notifications.reminders.testSent', error: false },
  blocked: { text: 'settings.notifications.reminders.testBlocked', error: true },
  failed: { text: 'settings.notifications.reminders.testFailed', error: true },
}

/**
 * Settings → Notifications → Reading Reminders: Enable Reminder, Reminder Time (local), the
 * once-a-day limit. The reminder itself is sent by Main's background worker — only on days you
 * haven't read yet, and only while Readmate is running (see Start at Login).
 */
export function ReadingRemindersCard() {
  const t = useT()
  const prefs = useNotificationsStore((s) => s.prefs)
  const saving = useNotificationsStore((s) => s.saving)
  const test = useNotificationsStore((s) => s.test)
  const setReminderEnabled = useNotificationsStore((s) => s.setReminderEnabled)
  const setReminderTime = useNotificationsStore((s) => s.setReminderTime)
  const sendTestReminder = useNotificationsStore((s) => s.sendTestReminder)

  // Local draft so a half-typed time isn't sent; committed when it is a complete HH:MM.
  const savedTime = prefs?.reminder.time ?? ''
  const [draftTime, setDraftTime] = useState(savedTime)
  useEffect(() => setDraftTime(savedTime), [savedTime])

  if (!prefs) return null
  const notificationsOn = prefs.enabled
  const reminderOn = prefs.reminder.enabled
  const testStatus = TEST_STATUS[test]

  function commitTime(value: string) {
    setDraftTime(value)
    if (/^\d{2}:\d{2}$/.test(value) && value !== savedTime) void setReminderTime(value)
  }

  return (
    <SettingsCard title={t('settings.notifications.reminders.title')}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p id="reminder-enable-label" className="m-0 text-[13px] text-lib-text-strong">
              {t('settings.notifications.reminders.enable')}
            </p>
            <p id="reminder-enable-desc" className="m-0 mt-1 text-[12px] text-lib-faint">
              {notificationsOn
                ? t('settings.notifications.reminders.enableOn')
                : t('settings.notifications.reminders.enableOff')}
            </p>
          </div>
          <SettingsSwitch
            checked={reminderOn}
            onChange={(next) => void setReminderEnabled(next)}
            labelledBy="reminder-enable-label"
            describedBy="reminder-enable-desc"
            disabled={saving || !notificationsOn}
          />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-lib-border-soft pt-4">
          <div className="min-w-0">
            <label htmlFor="reminder-time" className="m-0 block text-[13px] text-lib-text-strong">
              {t('settings.notifications.reminders.time')}
            </label>
            <p id="reminder-time-desc" className="m-0 mt-1 text-[12px] text-lib-faint">
              {t('settings.notifications.reminders.timeDescription')}
            </p>
          </div>
          <input
            id="reminder-time"
            type="time"
            required
            value={draftTime}
            aria-describedby="reminder-time-desc"
            disabled={!notificationsOn || !reminderOn}
            className="h-9 shrink-0 rounded-lg border border-lib-border bg-lib-input px-2.5 text-[13px] text-lib-text-strong tabular-nums outline-none settings-time-input select-text focus:border-lib-accent disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(e) => commitTime(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-lib-border-soft pt-4">
          <p className="m-0 text-[13px] text-lib-muted">
            {t('settings.notifications.reminders.frequency')}{' '}
            <span className="font-semibold text-lib-text-strong">{t('settings.notifications.reminders.frequencyValue')}</span>
          </p>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-3 text-[12px] font-semibold text-lib-text-strong transition-colors hover:border-lib-accent hover:bg-lib-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!notificationsOn || test === 'sending'}
            aria-busy={test === 'sending'}
            onClick={() => void sendTestReminder()}
          >
            {test === 'sending' ? t('settings.notifications.reminders.sending') : t('settings.notifications.reminders.sendTest')}
          </button>
        </div>

        {testStatus ? (
          <p
            role="status"
            className={`m-0 text-[12px] ${testStatus.error ? 'text-red-400' : 'text-lib-muted'}`}
          >
            {t(testStatus.text)}
          </p>
        ) : null}
      </div>
    </SettingsCard>
  )
}
