/**
 * The `app` methods, which sit directly on `window.api` (spec 008, T057). `onRequestFlushSession` fires when the
 * app goes to the background (the host's `lifecycle` event), so the Reader saves its position before the OS may end
 * the process; Android back arrives as `back` and becomes `history.back()`.
 */
import type { LifecyclePayload } from '../host/protocol'
import type { BridgeContext } from './context'
import { startSystemBarSync } from '@app/platforms/window-system-bars'
import { noEvents, notAvailable } from './unavailable'
import { createStepTimer, parseTimingLine, type StepTimer, type StepTiming } from '@core'

type Api = Window['api']
type AppMethods = Pick<
  Api,
  | 'ping'
  | 'getAppInfo'
  | 'getGoogleOAuthConfig'
  | 'setChromeTheme'
  | 'setUiLanguage'
  | 'getFullscreen'
  | 'setFullscreen'
  | 'toggleFullscreen'
  | 'onFullscreenChanged'
  | 'onRequestFlushSession'
  | 'captureSnapshot'
  | 'openExternalLink'
  | 'getTimingEnabled'
  | 'recordTiming'
  | 'setReaderOpening'
>

/** Spec 017: DOM event carrying the host's AppState to the Reader's opening store (`{ active: boolean }`). */
export const FOREGROUND_EVENT = 'readmate:foreground'

/** Spec 016: the last timing lines kept for the WebView devtools (development builds only). */
const TIMING_KEEP = 500

/** Spec 016 (research R1): timing is on only in a development build with `localStorage['readmate.devTiming'] = '1'`. */
function phoneTimingEnabled(): boolean {
  if (!import.meta.env.DEV) return false
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('readmate.devTiming') === '1'
  } catch {
    return false
  }
}

/** Spec 016: logs one timing line (logcat) and keeps it for the devtools. */
function recordPhoneTimingLine(line: StepTiming): boolean {
  if (!phoneTimingEnabled()) return false
  console.info('[timing]', JSON.stringify(line))
  if (typeof window !== 'undefined') {
    const kept = (window.__readmateTiming ??= [])
    kept.push(line)
    if (kept.length > TIMING_KEEP) kept.splice(0, kept.length - TIMING_KEEP)
  }
  return true
}

/** Spec 016: the bridge's own step timer (copy, fingerprint, details, save — `host: 'phone'`). No-op when off. */
export function phoneStepTimer(): StepTimer {
  return createStepTimer({ enabled: phoneTimingEnabled(), host: 'phone', sink: (t) => void recordPhoneTimingLine(t) })
}

declare global {
  interface Window {
    /** Spec 016: developer timing lines (development builds with `readmate.devTiming` only). */
    __readmateTiming?: unknown[]
  }
}

export function createAppGroup(ctx: BridgeContext): AppMethods {
  const flushHandlers = new Set<() => void | Promise<void>>()
  ctx.client.onEvent('lifecycle', (payload) => {
    const state = (payload as LifecyclePayload | null)?.state
    // Spec 017 (FR-003): the opening store counts foreground time only; `visibilitychange` may not fire inside the
    // Android WebView, so the host's AppState is passed on as a DOM event the store listens to.
    if ((state === 'active' || state === 'background') && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(FOREGROUND_EVENT, { detail: { active: state === 'active' } }))
    }
    if (state !== 'background') return
    for (const handler of flushHandlers) {
      void Promise.resolve()
        .then(handler)
        .catch((error: unknown) => console.warn('[bridge] session flush failed', error))
    }
  })
  ctx.client.onEvent('back', () => window.history.back())
  // Status / navigation bar colours follow the page (no DOM in the Node test suite, so nothing to follow there).
  const refreshSystemBars =
    typeof document !== 'undefined' && typeof requestAnimationFrame === 'function' ? startSystemBarSync(ctx.client) : () => {}

  return {
    ping: async () => 'pong',
    getAppInfo: async () => ({
      name: 'Readmate',
      version: ctx.boot.appVersion,
      // `NodeJS.Platform` has no 'ios'; nothing in the UI reads this value, and a wrong 'darwin' would claim macOS.
      platform: ctx.boot.platform as NodeJS.Platform,
      transcriptionSupported: false,
    }),
    // Cloud sources are not in the first release; null is the "not configured" answer the Cloud screen expects.
    getGoogleOAuthConfig: async () => null,
    // Desktop colours its window buttons here; on the phone the theme decides the status and navigation bar colours.
    setChromeTheme: async () => {
      refreshSystemBars()
      return { ok: true }
    },
    // Spec 012: no tray / Main on the phone; the WebView translates itself from the same preference.
    setUiLanguage: notAvailable('setUiLanguage'),
    getFullscreen: async () => false,
    setFullscreen: notAvailable('setFullscreen'),
    toggleFullscreen: notAvailable('toggleFullscreen'),
    onFullscreenChanged: noEvents,
    onRequestFlushSession(handler) {
      flushHandlers.add(handler)
      return () => flushHandlers.delete(handler)
    },
    captureSnapshot: notAvailable('captureSnapshot'),
    // Spec 017 (US3): the host's import chunk loops (copy / hash fallbacks) wait while a book opens; the WebView's own
    // gate (readerOpeningStore) holds the renderer's work. A host that cannot be told never blocks the Reader.
    async setReaderOpening(input) {
      const opening = input?.bookId != null
      try {
        await ctx.client.call('app', 'setReaderOpening', { opening })
      } catch {
        // best effort
      }
      return { ok: true }
    },
    getTimingEnabled: async () => phoneTimingEnabled(),
    // Logged for `adb logcat | grep '\[timing\]'`; the line carries format, size and duration only (core step-timing).
    async recordTiming(line) {
      const timing = parseTimingLine(line)
      return { ok: timing !== null && recordPhoneTimingLine(timing) }
    },
    async openExternalLink(url) {
      try {
        await ctx.client.call('app', 'openExternal', { url })
        return { ok: true }
      } catch {
        return { ok: false }
      }
    },
  }
}
