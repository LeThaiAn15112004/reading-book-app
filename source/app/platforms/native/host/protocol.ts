/**
 * The one channel between the WebView and the host (spec 008, `contracts/host-services.md`): small JSON messages,
 * version 1. This file is plain TypeScript with no React Native import, so the WebView bridge imports its types and
 * the vitest suite runs the host's dispatcher on Node.
 */

export const RPC_VERSION = 1

export interface RpcRequest {
  v: 1
  id: string
  service: string
  method: string
  args: unknown
}

export interface RpcError {
  code: HostErrorCode | string
  message: string
}

export type RpcResponse =
  | { v: 1; id: string; ok: true; result: unknown }
  | { v: 1; id: string; ok: false; error: RpcError }

export type HostEventName = 'lifecycle' | 'back' | 'importProgress'

export interface HostEvent {
  v: 1
  event: HostEventName
  payload: unknown
}

/** `lifecycle` payload. */
export interface LifecyclePayload {
  state: 'background' | 'active'
}

/** `importProgress` payload, sent while `files.stage` copies and `files.hashStaged` reads. */
export interface ImportProgressPayload {
  stagingId: string
  step: 'copying' | 'hashing'
  doneBytes: number
  totalBytes: number
}

/**
 * Values the WebView needs before the UI starts. `baseUrl` and `token` are null in Expo Go, where there is no local
 * server: book bytes then come through the development-only `files.readChunk` (`devChunks`).
 */
export interface BootValues {
  v: 1
  platform: 'android' | 'ios'
  osVersion: string
  appVersion: string
  baseUrl: string | null
  token: string | null
  devChunks: boolean
}

/** Stable failure codes. Each service documents which it can return. */
export type HostErrorCode =
  | 'UNKNOWN_METHOD'
  | 'BAD_REQUEST'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'NO_SPACE'
  | 'CANCELLED'
  | 'READ_FAILED'
  | 'WRITE_FAILED'
  | 'TOO_LARGE'
  | 'BOOK_TOO_LARGE_FOR_DEV'
  | 'SQL_FAILED'
  | 'RESULT_TOO_LARGE'
  | 'NOT_ALLOWED'
  | 'INTERNAL'

/** Thrown by a service method; the dispatcher turns it into `{ ok: false, error }`. */
export class HostServiceError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'HostServiceError'
  }
}

/** The development-only chunk route (`files.readChunk`): limits shared by the host and the bridge. */
export const DEV_CHUNK_MAX_BYTES = 1024 * 1024
export const DEV_BOOK_MAX_BYTES = 20 * 1024 * 1024

/** Global the bridge installs so the host can deliver responses and events with `injectJavaScript`. */
export const WEBVIEW_RECEIVER = '__readmateHostReceive'
