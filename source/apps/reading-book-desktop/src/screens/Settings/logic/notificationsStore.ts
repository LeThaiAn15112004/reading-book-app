import { create } from 'zustand'
import {
  notificationsApi,
  type NotificationPrefs,
  type NotificationPrefsResult,
  type ReadingReminderPrefs,
} from '../../../bridge/notifications'
import {
  requestNotificationPermission,
  type NotificationPermissionResult,
} from './notificationPermission'

/** Where the master switch lived before Main owned it — migrated once by `load()`, then removed. */
const LEGACY_STORAGE_KEY = 'reading-book.notifications.v1'

/** Why the switch was turned back off after the user tried to enable it. */
export type NotificationBlockedReason = Exclude<NotificationPermissionResult, 'granted'>

export type TestReminderState = 'idle' | 'sending' | 'sent' | 'blocked' | 'failed'

/** Bumped by every master-switch toggle / reset so a permission answer that arrives late is ignored. */
let requestSeq = 0

type NotificationsState = {
  /** Main's prefs; null until the first load answers. */
  prefs: NotificationPrefs | null
  loadFailed: boolean
  /** Master switch: permission check in flight — it shows ON and is disabled until it settles. */
  checking: boolean
  /** Set when enabling was refused; cleared by the next toggle or `dismissBlocked`. */
  blocked: NotificationBlockedReason | null
  /** A reminder change is being saved by Main. */
  saving: boolean
  /** The last change couldn't be saved; the controls show Main's unchanged value. */
  saveFailed: boolean
  test: TestReminderState
  load: () => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
  setReminderEnabled: (enabled: boolean) => Promise<void>
  setReminderTime: (time: string) => Promise<void>
  sendTestReminder: () => Promise<void>
  dismissBlocked: () => void
  /** Settings → Advanced → Reset App Settings: Main writes its own defaults. */
  reset: () => Promise<boolean>
}

function readLegacyEnabled(): boolean | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as { enabled?: unknown } | null
    return parsed?.enabled === true
  } catch {
    return null
  }
}

function clearLegacy(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Settings → Notifications: the master "Enable Notifications" switch and Reading Reminders. Main owns
 * them (`{userData}/notification-prefs.json`) because the reminder worker runs there, also while the
 * window is hidden; this store mirrors Main's answers. Turning the master switch on checks OS
 * support + permission first; when that is refused it goes back to OFF and `blocked` says why.
 */
export const useNotificationsStore = create<NotificationsState>()((set, get) => {
  /** Apply Main's answer: its `prefs` are always the truth, `ok: false` = not saved. */
  function applyResult(result: NotificationPrefsResult): void {
    set({ prefs: result.prefs, saveFailed: !result.ok })
  }

  async function saveReminder(patch: Partial<ReadingReminderPrefs>): Promise<void> {
    const previous = get().prefs
    if (!previous || get().saving) return
    set({ prefs: { ...previous, reminder: { ...previous.reminder, ...patch } }, saving: true, saveFailed: false })
    try {
      applyResult(await notificationsApi.setReminder(patch))
    } catch {
      set({ prefs: previous, saveFailed: true })
    } finally {
      set({ saving: false })
    }
  }

  return {
    prefs: null,
    loadFailed: false,
    checking: false,
    blocked: null,
    saving: false,
    saveFailed: false,
    test: 'idle',

    load: async () => {
      try {
        let prefs = await notificationsApi.getPrefs()
        const legacy = readLegacyEnabled()
        if (legacy === true && !prefs.enabled) {
          const result = await notificationsApi.setEnabled(true)
          prefs = result.prefs
          if (result.ok) clearLegacy()
        } else if (legacy !== null) {
          clearLegacy()
        }
        set({ prefs, loadFailed: false })
      } catch {
        set({ loadFailed: true })
      }
    },

    setEnabled: async (enabled) => {
      const previous = get().prefs
      if (!previous || get().checking) return
      const seq = ++requestSeq
      set({ saveFailed: false, test: 'idle' })
      if (!enabled) {
        set({ prefs: { ...previous, enabled: false }, blocked: null })
        try {
          applyResult(await notificationsApi.setEnabled(false))
        } catch {
          if (seq === requestSeq) set({ prefs: previous, saveFailed: true })
        }
        return
      }
      // Optimistic ON while the OS check runs, so the switch answers the click immediately.
      set({ prefs: { ...previous, enabled: true }, checking: true, blocked: null })
      const permission = await requestNotificationPermission()
      if (seq !== requestSeq) return
      if (permission !== 'granted') {
        set({ prefs: { ...previous, enabled: false }, checking: false, blocked: permission })
        return
      }
      try {
        const result = await notificationsApi.setEnabled(true)
        if (seq !== requestSeq) return
        applyResult(result)
      } catch {
        if (seq === requestSeq) set({ prefs: previous, saveFailed: true })
      } finally {
        if (seq === requestSeq) set({ checking: false })
      }
    },

    setReminderEnabled: (enabled) => saveReminder({ enabled }),
    setReminderTime: (time) => saveReminder({ time }),

    sendTestReminder: async () => {
      if (get().test === 'sending') return
      set({ test: 'sending' })
      try {
        const { status } = await notificationsApi.sendTestReminder()
        set({ test: status })
      } catch {
        set({ test: 'failed' })
      }
    },

    dismissBlocked: () => set({ blocked: null }),

    reset: async () => {
      requestSeq += 1
      set({ checking: false, blocked: null, test: 'idle' })
      try {
        const result = await notificationsApi.resetPrefs()
        set({ prefs: result.prefs, saveFailed: false, loadFailed: false })
        return result.ok
      } catch {
        return false
      }
    },
  }
})
