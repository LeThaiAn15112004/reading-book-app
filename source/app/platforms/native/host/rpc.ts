/**
 * Host-side RPC dispatcher (spec 008, T050, T091; `contracts/host-services.md`). It takes the raw string the WebView
 * posted and the URL of the page that posted it, and answers one `RpcResponse`, or nothing for a message from any
 * other origin. Unknown services and methods, and own-property lookups such as `__proto__` or `toString`, answer
 * `UNKNOWN_METHOD`. Plain TypeScript: no React Native import, so the vitest suite drives it on Node.
 */
import { HostServiceError, RPC_VERSION, type RpcRequest, type RpcResponse } from './protocol'

export type ServiceMethod = (args: unknown) => unknown
export type ServiceTable = Record<string, Record<string, ServiceMethod>>

export interface RpcDispatcherOptions {
  services: ServiceTable
  /** The origin of the UI page, from `resolveUiSource()`: the local server, or Metro in Expo Go. */
  allowedOrigin: string
  /** Called for an unexpected (non-`HostServiceError`) failure; the WebView only gets a generic message. */
  onInternalError?: (error: unknown, request: Pick<RpcRequest, 'service' | 'method'>) => void
}

const MAX_MESSAGE_CHARS = 8 * 1024 * 1024
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** `http://host:port` of a page URL, or undefined when it has none (`about:blank`, malformed). */
export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  const match = /^(https?:\/\/[^/?#]+)/i.exec(url)
  return match ? match[1]!.toLowerCase() : undefined
}

function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
}

export function createRpcDispatcher(options: RpcDispatcherOptions) {
  const allowed = options.allowedOrigin.toLowerCase().replace(/\/$/, '')

  async function handle(raw: string, pageUrl: string | undefined): Promise<RpcResponse | null> {
    if (originOf(pageUrl) !== allowed) return null
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS) return null
    let message: Partial<RpcRequest>
    try {
      message = JSON.parse(raw) as Partial<RpcRequest>
    } catch {
      return null
    }
    if (!message || typeof message !== 'object' || typeof message.id !== 'string' || !ID_PATTERN.test(message.id)) return null
    const id = message.id
    const fail = (code: string, text: string): RpcResponse => ({ v: RPC_VERSION, id, ok: false, error: { code, message: text } })
    if (message.v !== RPC_VERSION) return fail('BAD_REQUEST', `Unsupported protocol version ${String(message.v)}`)
    if (typeof message.service !== 'string' || typeof message.method !== 'string') return fail('BAD_REQUEST', 'service and method are required')

    const service = own(options.services, message.service)
    const method = service ? own(service, message.method) : undefined
    if (typeof method !== 'function') return fail('UNKNOWN_METHOD', `${message.service}.${message.method} is not a host method`)

    try {
      const result = await method(message.args ?? {})
      return { v: RPC_VERSION, id, ok: true, result: result === undefined ? null : result }
    } catch (error) {
      if (error instanceof HostServiceError) return fail(error.code, error.message)
      options.onInternalError?.(error, { service: message.service, method: message.method })
      return fail('INTERNAL', `${message.service}.${message.method} failed`)
    }
  }

  return { handle }
}

/** Reads a plain-object argument; anything else is a bad request. */
export function argsObject(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new HostServiceError('BAD_REQUEST', 'Arguments must be an object')
  return args as Record<string, unknown>
}
