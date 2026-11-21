/**
 * Spec 016 (FR-013b, contracts/phone-host.md): the phone's saved import queue — `importQueue.load` / `save` in the host
 * (`import-queue.json`, no bytes, no path). Desktop has no such group: its queue is session-only.
 */
import type { BridgeContext } from './context'

type ImportQueueGroup = NonNullable<Window['api']['importQueue']>

export function createImportQueueGroup(ctx: BridgeContext): ImportQueueGroup {
  return {
    async load() {
      try {
        return (await ctx.client.call('importQueue', 'load')) as Awaited<ReturnType<ImportQueueGroup['load']>>
      } catch {
        return null
      }
    },
    async save(snapshot) {
      try {
        await ctx.client.call('importQueue', 'save', { snapshot })
        return { ok: true }
      } catch {
        return { ok: false }
      }
    },
  }
}
