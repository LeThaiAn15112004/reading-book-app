/**
 * The Mobile `window.api` (spec 008, T063; `contracts/mobile-bridge.md`): Desktop's `DesktopApi`, from the type
 * Desktop's UI already sees (`Window['api']`, declared in `electron/electron-env.d.ts`, so no import from
 * `electron/` is needed). The implemented groups are written method by method, so TypeScript fails when Desktop adds
 * a method that Mobile does not answer; the groups the first release does not have are `unavailableGroup`s.
 *
 * Start-up order: migrate the database, then sweep `staging/` and orphan book folders, then hand out the API.
 */
import type { BootValues } from '../../../src/host/protocol'
import { migrate } from '../db/migrate'
import { MobileLibraryStore } from '../stores/library-store'
import { MobileOverlayStore } from '../stores/overlay-store'
import { createAppGroup } from './app'
import { createBookContentSource } from './book-content'
import type { BridgeContext } from './context'
import { createHostClient, createWriteQueue, readBootValues, type HostClient, type HostTransport } from './host-client'
import { createHostSqlDriver } from './host-sql-driver'
import { createImportGroup } from './import'
import { createLibraryGroup } from './library'
import { createOverlayGroup } from './overlay'
import { createTxtGroup } from './txt'
import { setUnavailableReporter, unavailableGroup } from './unavailable'

export type DesktopApi = Window['api']

export interface MobileApiOptions {
  client: HostClient
  boot: BootValues
  newId?: () => string
  fetchImpl?: typeof fetch
}

export function createMobileApi(options: MobileApiOptions): { api: DesktopApi; ctx: BridgeContext } {
  const { client, boot } = options
  const db = createHostSqlDriver(client)
  const ctx: BridgeContext = {
    client,
    boot,
    db,
    library: new MobileLibraryStore(db),
    overlay: new MobileOverlayStore(db),
    content: createBookContentSource(client, boot, options.fetchImpl),
    writes: createWriteQueue(),
    newId: options.newId ?? (() => globalThis.crypto.randomUUID()),
  }
  const api = {
    ...createAppGroup(ctx),
    library: createLibraryGroup(ctx),
    import: createImportGroup(ctx),
    overlay: createOverlayGroup(ctx),
    txt: createTxtGroup(ctx),
    graphics: unavailableGroup<DesktopApi['graphics']>('graphics'),
    attachments: unavailableGroup<DesktopApi['attachments']>('attachments'),
    annotationTransfer: unavailableGroup<DesktopApi['annotationTransfer']>('annotationTransfer'),
    zipImport: unavailableGroup<DesktopApi['zipImport']>('zipImport'),
    audio: unavailableGroup<DesktopApi['audio']>('audio'),
    bookIndex: unavailableGroup<DesktopApi['bookIndex']>('bookIndex'),
    search: unavailableGroup<DesktopApi['search']>('search'),
    wordCount: unavailableGroup<DesktopApi['wordCount']>('wordCount'),
    cloud: unavailableGroup<DesktopApi['cloud']>('cloud'),
    notifications: unavailableGroup<DesktopApi['notifications']>('notifications'),
    background: unavailableGroup<DesktopApi['background']>('background'),
    updates: unavailableGroup<DesktopApi['updates']>('updates'),
    storage: unavailableGroup<DesktopApi['storage']>('storage'),
    translation: unavailableGroup<DesktopApi['translation']>('translation'),
    transcription: unavailableGroup<DesktopApi['transcription']>('transcription'),
  } satisfies DesktopApi
  return { api, ctx }
}

/** Migration + startup sweep (`data-model.md`: staging emptied, book folders without a row removed). */
export async function prepareMobileStorage(ctx: BridgeContext): Promise<void> {
  await migrate(ctx.db)
  const knownBookIds = await ctx.library.allBookIds()
  await ctx.client.call('files', 'sweep', { knownBookIds })
}

export interface BridgeCallLog {
  calls: Record<string, number>
  notAvailable: Record<string, number>
}

/**
 * T064: counts every bridge call by `group.method`, and every not-available method reached. In the WebView the log is
 * `window.__readmateBridgeLog` (read it from the remote debugger after a journey run).
 */
export function withCallLog(api: DesktopApi, log: BridgeCallLog = { calls: {}, notAvailable: {} }): DesktopApi {
  setUnavailableReporter((method) => {
    log.notAvailable[method] = (log.notAvailable[method] ?? 0) + 1
    console.warn(`[bridge] NOT_AVAILABLE_ON_PLATFORM reached: ${method}`)
  })
  const count = (name: string) => {
    log.calls[name] = (log.calls[name] ?? 0) + 1
  }
  const wrap = <T extends object>(target: T, prefix: string): T =>
    new Proxy(target, {
      get(obj, key, receiver) {
        const value = Reflect.get(obj, key, receiver)
        if (typeof key !== 'string') return value
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            count(prefix + key)
            return (value as (...a: unknown[]) => unknown).apply(obj, args)
          }
        }
        if (value && typeof value === 'object') return wrap(value as object, `${prefix}${key}.`)
        return value
      },
    })
  return wrap(api, '')
}

/** Everything `main.ts` needs: transport → client → boot values → API → storage ready. */
export async function startMobileBridge(transport: HostTransport): Promise<{ api: DesktopApi; log: BridgeCallLog }> {
  const client = createHostClient(transport)
  const boot = await readBootValues(client)
  const { api, ctx } = createMobileApi({ client, boot })
  await prepareMobileStorage(ctx)
  const log: BridgeCallLog = { calls: {}, notAvailable: {} }
  return { api: withCallLog(api, log), log }
}
