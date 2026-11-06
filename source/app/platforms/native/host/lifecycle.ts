/**
 * Lifecycle (spec 008, T055; `contracts/host-services.md`, Lifecycle):
 *   - background → `lifecycle { state: 'background' }`, and the bridge runs `onRequestFlushSession`;
 *   - foreground → the local server is checked and restarted if the OS stopped it, then `lifecycle { state: 'active' }`;
 *   - Android back → `back` while the WebView can go back (the bridge calls `history.back()`); at the root the
 *     default handler runs and the app exits normally.
 * Reloading after the WebView process dies is done by the screen (`onRenderProcessGone`,
 * `onContentProcessDidTerminate`), since it owns the WebView.
 */
import { useEffect, useRef } from 'react'
import { AppState, BackHandler, Platform } from 'react-native'

import { isLocalServerRunning, startLocalServer } from './local-server'
import type { HostEventName } from './protocol'

export interface HostLifecycleOptions {
  /** False until the WebView and its runtime exist. */
  enabled: boolean
  /** Whether a local server should be running (false in Expo Go). */
  usesLocalServer: boolean
  send: (event: HostEventName, payload: unknown) => void
}

export function useHostLifecycle({ enabled, usesLocalServer, send }: HostLifecycleOptions) {
  const canGoBack = useRef(false)

  useEffect(() => {
    if (!enabled) return
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        send('lifecycle', { state: 'background' })
      } else if (state === 'active') {
        void (async () => {
          if (usesLocalServer) {
            try {
              if (!isLocalServerRunning()) await startLocalServer()
            } catch (error) {
              console.warn('[host] the local server could not be restarted', error)
            }
          }
          send('lifecycle', { state: 'active' })
        })()
      }
    })
    return () => subscription.remove()
  }, [enabled, usesLocalServer, send])

  useEffect(() => {
    if (!enabled || Platform.OS !== 'android') return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack.current) return false
      send('back', null)
      return true
    })
    return () => subscription.remove()
  }, [enabled, send])

  return {
    /** From `onNavigationStateChange`; `HashRouter` pushes history entries, so the WebView knows. */
    setCanGoBack(value: boolean) {
      canGoBack.current = value
    },
  }
}

/** Navigation inside the WebView: the UI's own origin only, plus `about:` and `blob:` (PDF.js, downloads). */
export function isInsideUi(url: string, origin: string): boolean {
  return url.startsWith(`${origin}/`) || url === origin || url.startsWith('about:') || url.startsWith('blob:') || url.startsWith('data:')
}
