/**
 * `app.info`, `app.openExternal` (spec 008, T053). Platform values and the opener are injected, so the rules run
 * in the vitest suite. A link leaves the app only as `https`, to a public host name, after the allowlist check.
 */
import { HostServiceError } from './protocol'
import { argsObject } from './rpc'

export interface AppInfoValues {
  version: string
  platform: 'android' | 'ios'
  osVersion: string
}

/** Colours under the status bar (top) and the navigation bar (bottom), as `#rrggbb`. */
export interface SystemBarColors {
  top: string
  bottom: string
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export interface AppServiceOptions {
  info: AppInfoValues
  openUrl: (url: string) => Promise<void>
  /** The UI's edge colours changed; the screen paints the system bar areas with them. */
  onSystemBars?: (colors: SystemBarColors) => void
  /** Extra rule on top of the built-in checks; true = allowed. Default: any public https host. */
  isAllowedHost?: (host: string) => boolean
}

const MAX_URL_CHARS = 2048

/** `https://public.host/...` with no credentials and no loopback / private address; the host name, or undefined. */
export function externalHostOf(url: unknown): string | undefined {
  if (typeof url !== 'string' || url.length > MAX_URL_CHARS) return undefined
  const match = /^https:\/\/([^/?#@\s]+)(?:[/?#][^\s]*)?$/i.exec(url.trim())
  if (!match) return undefined
  const host = match[1]!.toLowerCase().replace(/:\d+$/, '')
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.') || host.startsWith('.') || host.endsWith('.')) return undefined
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return undefined
  if (/^\d+(\.\d+){3}$/.test(host)) return undefined
  return host
}

export function createAppService(options: AppServiceOptions) {
  return {
    info(): AppInfoValues {
      return { ...options.info }
    },
    /** Edge-to-edge bars are transparent: the host paints what is behind them in the app's own colours. */
    setSystemBars(raw: unknown): { applied: true } {
      const { top, bottom } = argsObject(raw)
      if (typeof top !== 'string' || !HEX_COLOR.test(top) || typeof bottom !== 'string' || !HEX_COLOR.test(bottom)) {
        throw new HostServiceError('INVALID_ARGUMENT', 'top and bottom must be #rrggbb colours')
      }
      options.onSystemBars?.({ top: top.toLowerCase(), bottom: bottom.toLowerCase() })
      return { applied: true }
    },
    async openExternal(raw: unknown): Promise<{ opened: true }> {
      const url = argsObject(raw).url
      const host = externalHostOf(url)
      if (!host || (options.isAllowedHost && !options.isAllowedHost(host))) {
        throw new HostServiceError('NOT_ALLOWED', 'Only https links to a public site can be opened')
      }
      try {
        await options.openUrl((url as string).trim())
      } catch {
        throw new HostServiceError('INTERNAL', 'The link could not be opened')
      }
      return { opened: true }
    },
  }
}
