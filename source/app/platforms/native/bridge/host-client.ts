/**
 * The WebView side of the host channel (spec 008, T056; `contracts/host-services.md`): requests out through
 * `ReactNativeWebView.postMessage`, responses and events in through a receiver the host calls with
 * `injectJavaScript`. Also the single write queue: every bridge method that writes runs through it, one at a time,
 * so two host transactions never meet ("database is locked") and a read-then-write in a store sees its own order.
 */
import {
  RPC_VERSION,
  WEBVIEW_RECEIVER,
  type BootValues,
  type HostEvent,
  type HostEventName,
  type RpcRequest,
  type RpcResponse,
} from '../host/protocol'

export interface HostTransport {
  post(json: string): void
  /** Installs the one receiver for host → WebView messages. */
  listen(receive: (json: string) => void): void
}

/** A failed host call, with the host's stable code (`NO_SPACE`, `CANCELLED`, `UNKNOWN_METHOD`, …). */
export class HostCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly service: string,
    readonly method: string,
  ) {
    super(message)
    this.name = 'HostCallError'
  }
}

export interface CallOptions {
  /** Milliseconds; 0 = no timeout (copying or hashing a large book). Default 30 s. */
  timeoutMs?: number
}

export interface HostClient {
  call<T>(service: string, method: string, args?: unknown, options?: CallOptions): Promise<T>
  onEvent(event: HostEventName, handler: (payload: unknown) => void): () => void
}

export interface WriteQueue {
  run<T>(task: () => Promise<T>): Promise<T>
}

const DEFAULT_TIMEOUT_MS = 30_000

export function createHostClient(transport: HostTransport, newId: () => string = () => globalThis.crypto.randomUUID()): HostClient {
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void; service: string; method: string; timer?: ReturnType<typeof setTimeout> }>()
  const listeners = new Map<HostEventName, Set<(payload: unknown) => void>>()

  transport.listen((json) => {
    let message: RpcResponse | HostEvent
    try {
      message = JSON.parse(json) as RpcResponse | HostEvent
    } catch {
      return
    }
    if (!message || message.v !== RPC_VERSION) return
    if ('event' in message) {
      for (const handler of listeners.get(message.event) ?? []) {
        try {
          handler(message.payload)
        } catch (error) {
          console.warn(`[bridge] ${message.event} handler failed`, error)
        }
      }
      return
    }
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (entry.timer) clearTimeout(entry.timer)
    if (message.ok) entry.resolve(message.result)
    else entry.reject(new HostCallError(message.error.code, message.error.message, entry.service, entry.method))
  })

  return {
    call<T>(service: string, method: string, args: unknown = {}, options: CallOptions = {}): Promise<T> {
      const id = newId().replace(/[^A-Za-z0-9_-]/g, '')
      const request: RpcRequest = { v: RPC_VERSION, id, service, method, args }
      return new Promise<T>((resolve, reject) => {
        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        const timer =
          timeoutMs > 0
            ? setTimeout(() => {
                pending.delete(id)
                reject(new HostCallError('TIMEOUT', `${service}.${method} did not answer`, service, method))
              }, timeoutMs)
            : undefined
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, service, method, timer })
        try {
          transport.post(JSON.stringify(request))
        } catch (error) {
          pending.delete(id)
          if (timer) clearTimeout(timer)
          reject(error)
        }
      })
    },
    onEvent(event, handler) {
      const set = listeners.get(event) ?? new Set()
      set.add(handler)
      listeners.set(event, set)
      return () => set.delete(handler)
    },
  }
}

export function createWriteQueue(): WriteQueue {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const next = tail.then(task, task)
      // A failed write must not stop the ones queued after it.
      tail = next.catch(() => undefined)
      return next
    },
  }
}

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void; injectedObjectJson?(): string | undefined }
    __READMATE_BOOT__?: BootValues
    [WEBVIEW_RECEIVER]?: (json: string) => void
  }
}

/** The real transport, or undefined when the page is not inside the Mobile host (a desktop browser on Metro). */
export function createWebViewTransport(): HostTransport | undefined {
  const native = window.ReactNativeWebView
  if (!native) return undefined
  return {
    post: (json) => native.postMessage(json),
    listen: (receive) => {
      window[WEBVIEW_RECEIVER] = receive
    },
  }
}

function isBootValues(value: unknown): value is BootValues {
  const v = value as Partial<BootValues> | null
  return !!v && v.v === RPC_VERSION && (v.platform === 'android' || v.platform === 'ios') && typeof v.devChunks === 'boolean'
}

/** Injected script (iOS), injected object (Android), or a boot request when neither arrived. */
export async function readBootValues(client: HostClient): Promise<BootValues> {
  if (isBootValues(window.__READMATE_BOOT__)) return window.__READMATE_BOOT__
  try {
    const injected = window.ReactNativeWebView?.injectedObjectJson?.()
    const parsed: unknown = injected ? JSON.parse(injected) : undefined
    if (isBootValues(parsed)) return parsed
  } catch {
    // Fall through to the boot request.
  }
  const asked = await client.call<unknown>('app', 'boot')
  if (!isBootValues(asked)) throw new Error('The host did not send its boot values')
  return asked
}
