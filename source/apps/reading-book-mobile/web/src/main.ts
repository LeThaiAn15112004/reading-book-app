import { startMobileBridge, type BridgeCallLog } from './bridge'
import { createWebViewTransport } from './bridge/host-client'
import { createStubApi } from './bridge/stub'
import { installSecureContextShims } from './secure-context-shims'

declare global {
  interface Window {
    /** Declares the Mobile host to the shared UI. Electron never sets it. */
    __READMATE_HOST__?: 'mobile'
    /** T064: bridge calls of this page load, for the journey log. */
    __readmateBridgeLog?: BridgeCallLog
  }
}

window.__READMATE_HOST__ = 'mobile'
document.documentElement.dataset.mobileHost = ''
installSecureContextShims()

async function createApi(): Promise<object> {
  // `--mode feasibility` only; this branch is dropped from the normal build.
  if (import.meta.env.MODE === 'feasibility') return (await import('./feasibility/fake-api')).createFakeApi()
  const transport = createWebViewTransport()
  // Outside the Mobile host (the page opened in a desktop browser from Metro) there is no host: an empty Library.
  if (!transport) return createStubApi()
  const { api, log } = await startMobileBridge(transport)
  window.__readmateBridgeLog = log
  return api
}

async function boot() {
  Object.defineProperty(window, 'api', { value: await createApi() })
  // Loaded only after window.api exists: Desktop's UI source is the input, never a copy.
  await import('@app/main')
}

boot().catch((error: unknown) => {
  document.body.textContent = `Readmate could not start: ${String(error)}`
})
