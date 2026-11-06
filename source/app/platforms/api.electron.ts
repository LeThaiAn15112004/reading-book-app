/**
 * Platform adapter `api`, Desktop renderer (spec 009 T043): the `window.api` that `electron/preload.ts` exposes through
 * `contextBridge`. This file is the only UI code that touches `window.api` (ESLint R9).
 *
 * `api` forwards every access to the current `window.api` instead of capturing it, so the checks that install a
 * fake `window.api` after the modules are loaded (the spikes) still see their own object.
 */
import type { DesktopApi } from '../../apps/reading-book-desktop/electron/ipc/api-types'

export type { DesktopApi }

export const api: DesktopApi = new Proxy({} as DesktopApi, {
  get(_target, key) {
    const current = window.api as unknown as Record<string | symbol, unknown>
    const value = current[key]
    return typeof value === 'function' ? value.bind(current) : value
  },
})
