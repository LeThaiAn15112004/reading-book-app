/**
 * The host's service table (spec 008, M4): `sql`, `files`, `app`, behind one RPC dispatcher whose only accepted
 * origin is the UI page's (`resolveUiSource()`, T091). `files.readChunk` / `files.readCover` exist only in Expo Go.
 */
import Constants from 'expo-constants'
import { Linking, Platform } from 'react-native'

import { createAppService, type SystemBarColors } from './app-service'
import { createExpoHostFs } from './expo-host-fs'
import { openExpoSqliteEngine } from './expo-sqlite-engine'
import { createFileService } from './file-service'
import { RPC_VERSION, type BootValues, type HostEvent, type HostEventName, type RpcResponse } from './protocol'
import { createRpcDispatcher, type ServiceTable } from './rpc'
import { createSqlService, type SqlEngine } from './sql-service'
import type { UiSource } from './ui-source'

export interface HostRuntime {
  boot: BootValues
  handleMessage(raw: string, pageUrl: string | undefined): Promise<RpcResponse | null>
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export function createHostRuntime(
  source: UiSource,
  emit: (event: HostEvent) => void,
  onSystemBars?: (colors: SystemBarColors) => void,
): HostRuntime {
  const devChunks = source.baseUrl === null
  const platform: BootValues['platform'] = Platform.OS === 'ios' ? 'ios' : 'android'
  const boot: BootValues = {
    v: RPC_VERSION,
    platform,
    osVersion: String(Platform.Version),
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    baseUrl: source.baseUrl,
    token: source.token,
    devChunks,
  }
  const send = (event: HostEventName, payload: unknown) => emit({ v: RPC_VERSION, event, payload })

  let engine: Promise<SqlEngine> | undefined
  const sqlEngine = () => (engine ??= openExpoSqliteEngine())
  const lazySql: SqlEngine = {
    all: async (sql, params) => (await sqlEngine()).all(sql, params),
    run: async (sql, params) => (await sqlEngine()).run(sql, params),
    exclusiveTransaction: async (task) => (await sqlEngine()).exclusiveTransaction(task),
  }

  const services: ServiceTable = {
    sql: createSqlService(lazySql),
    files: createFileService({
      fs: createExpoHostFs(),
      devChunks,
      emitProgress: (payload) => send('importProgress', payload),
      yieldToEvents: nextTick,
    }),
    app: {
      ...createAppService({
        info: { version: boot.appVersion, platform, osVersion: boot.osVersion },
        openUrl: (url) => Linking.openURL(url),
        onSystemBars,
      }),
      /** Android fallback when the injected boot object did not arrive (`contracts/host-services.md`). */
      boot: () => boot,
    },
  }

  const dispatcher = createRpcDispatcher({
    services,
    allowedOrigin: source.origin,
    onInternalError: (error, at) => console.warn(`[host] ${at.service}.${at.method} failed`, error),
  })
  return { boot, handleMessage: dispatcher.handle }
}

/** JavaScript that hands one JSON message to the bridge's receiver; the JSON travels as a string literal. */
export function deliveryScript(receiver: string, message: unknown): string {
  return `window.${receiver}&&window.${receiver}(${JSON.stringify(JSON.stringify(message))});true;`
}
