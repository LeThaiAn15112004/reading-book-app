import { create } from 'zustand'
import {
  requestNotificationPermission,
  type NotificationPermissionResult,
} from './notificationPermission'

const STORAGE_KEY = 'reading-book.notifications.v1'

export type NotificationPrefs = { enabled: boolean }

/** Single source of the notification defaults (first run and Settings → Reset App Settings). */
export const DEFAULT_NOTIFICATION_PREFS: Readonly<NotificationPrefs> = { enabled: false }

function load(): NotificationPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<NotificationPrefs> | null
    return {
      enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : DEFAULT_NOTIFICATION_PREFS.enabled,
    }
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS }
  }
}

/** Returns false when the write failed (quota / private mode) — the choice just won't persist. */
function save(prefs: NotificationPrefs): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    return true
  } catch {
    return false
  }
}

/** Bumped by every toggle / reset so a permission answer that arrives late is ignored. */
let requestSeq = 0

/** Why the switch was turned back off after the user tried to enable it. */
export type NotificationBlockedReason = Exclude<NotificationPermissionResult, 'granted'>

type NotificationsState = {
  notifications: NotificationPrefs
  /** Permission check in flight — the switch shows ON and is disabled until it settles. */
  checking: boolean
  /** Set when enabling was refused; cleared by the next toggle or `dismissBlocked`. */
  blocked: NotificationBlockedReason | null
  setEnabled: (enabled: boolean) => Promise<void>
  dismissBlocked: () => void
  /** Settings → Advanced → Reset App Settings. Returns false when the write failed. */
  reset: () => boolean
}

/**
 * Settings → Notifications: the master "Enable Notifications" switch, persisted in localStorage like
 * the other app preferences. Turning it on checks OS support + permission first; when that is
 * refused the switch goes back to OFF and `blocked` says why.
 */
export const useNotificationsStore = create<NotificationsState>()((set, get) => ({
  notifications: load(),
  checking: false,
  blocked: null,

  setEnabled: async (enabled) => {
    if (get().checking) return
    const seq = ++requestSeq
    if (!enabled) {
      set({ notifications: { enabled: false }, blocked: null })
      save({ enabled: false })
      return
    }
    // Optimistic ON while the OS check runs, so the switch answers the click immediately.
    set({ notifications: { enabled: true }, checking: true, blocked: null })
    const result = await requestNotificationPermission()
    if (seq !== requestSeq) return
    if (result === 'granted') {
      set({ checking: false })
      save({ enabled: true })
    } else {
      set({ notifications: { enabled: false }, checking: false, blocked: result })
      save({ enabled: false })
    }
  },

  dismissBlocked: () => set({ blocked: null }),

  reset: () => {
    requestSeq += 1
    const notifications = { ...DEFAULT_NOTIFICATION_PREFS }
    set({ notifications, checking: false, blocked: null })
    return save(notifications)
  },
}))
