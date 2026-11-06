import { installSecureContextShims } from './secure-context-shims'

document.documentElement.dataset.mobileHost = ''
installSecureContextShims()

// The shared UI builds its own `api` (spec 009 T043: `source/app/platforms/api.native.ts`), awaiting the host handshake.
import('@app/main').catch((error: unknown) => {
  document.body.textContent = `Readmate could not start: ${String(error)}`
})
