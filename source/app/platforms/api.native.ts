/**
 * Platform adapter `api`, Mobile WebView (spec 009 T043): the Mobile Bridge, built here instead of being injected as
 * `window.api` by the web entry. The handshake with the React Native host is asynchronous, so the module awaits it
 * (top-level await): every module that imports `api` is evaluated only after the bridge exists.
 */
import { createWebViewApi } from './native/create-api'
import type { DesktopApi } from './native/bridge'

export type { DesktopApi }

export const api: DesktopApi = (await createWebViewApi()) as DesktopApi
