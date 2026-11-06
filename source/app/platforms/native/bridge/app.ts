/**
 * The `app` methods, which sit directly on `window.api` (spec 008, T057). `onRequestFlushSession` fires when the
 * app goes to the background (the host's `lifecycle` event), so the Reader saves its position before the OS may end
 * the process; Android back arrives as `back` and becomes `history.back()`.
 */
import type { LifecyclePayload } from '../host/protocol'
import type { BridgeContext } from './context'
import { startSystemBarSync } from '@app/platforms/window-system-bars'
import { noEvents, notAvailable } from './unavailable'

type Api = Window['api']
type AppMethods = Pick<
  Api,
  | 'ping'
  | 'getAppInfo'
  | 'getGoogleOAuthConfig'
  | 'setChromeTheme'
  | 'getFullscreen'
  | 'setFullscreen'
  | 'toggleFullscreen'
  | 'onFullscreenChanged'
  | 'onRequestFlushSession'
  | 'captureSnapshot'
  | 'openExternalLink'
>

export function createAppGroup(ctx: BridgeContext): AppMethods {
  const flushHandlers = new Set<() => void | Promise<void>>()
  ctx.client.onEvent('lifecycle', (payload) => {
    if ((payload as LifecyclePayload | null)?.state !== 'background') return
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
    getFullscreen: async () => false,
    setFullscreen: notAvailable('setFullscreen'),
    toggleFullscreen: notAvailable('toggleFullscreen'),
    onFullscreenChanged: noEvents,
    onRequestFlushSession(handler) {
      flushHandlers.add(handler)
      return () => flushHandlers.delete(handler)
    },
    captureSnapshot: notAvailable('captureSnapshot'),
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
