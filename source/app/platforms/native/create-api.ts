import { startMobileBridge, type BridgeCallLog } from './bridge'
import { createWebViewTransport } from './bridge/host-client'
import { createStubApi } from './bridge/stub'

declare global {
  interface Window {
    /** T064: bridge calls of this page load, for the journey log. */
    __readmateBridgeLog?: BridgeCallLog
  }
}

/** The Mobile `api` of the shared UI (spec 009 T043: was built by `main.ts` and injected as `window.api`). */
export async function createWebViewApi(): Promise<object> {
  // `--mode feasibility` only; this branch is dropped from the normal build.
  if (import.meta.env.MODE === 'feasibility') return (await import('./feasibility/fake-api')).createFakeApi()
  const transport = createWebViewTransport()
  // Outside the Mobile host (the page opened in a desktop browser from Metro) there is no host: an empty Library.
  if (!transport) return createStubApi()
  const { api, log } = await startMobileBridge(transport)
  window.__readmateBridgeLog = log
  return api
}
