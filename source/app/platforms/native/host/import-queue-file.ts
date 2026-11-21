/**
 * Spec 016 (FR-013b, contracts/phone-host.md): the phone keeps its unfinished import jobs across launches.
 *
 * - `import-queue.json` — the WebView's queue snapshot (shown name, source, state, order — never bytes or a path),
 *   written atomically (temp file + move) on `importQueue.save`, read once at launch by `importQueue.load`.
 *   At most 200 jobs and 256 KiB, else `INVALID_ARGUMENT`.
 * - `import-picks.json` — host only: `pickId → { uri, name, size }` of picked files, so a waiting job can still run
 *   after a relaunch (`files.checkPick` tells whether the system still lets the app read it). Never sent to the WebView.
 */
import type { HostFs, PickedDocument } from './file-service'
import { HostServiceError } from './protocol'

export const QUEUE_FILE = 'import-queue.json'
export const PICKS_FILE = 'import-picks.json'
export const QUEUE_LIMITS = { maxJobs: 200, maxBytes: 256 * 1024 } as const

type JsonFs = Pick<HostFs, 'fileSize' | 'readRange' | 'writeFile' | 'move' | 'remove'>

function readJson(fs: JsonFs, rel: string): unknown {
  const size = fs.fileSize(rel)
  if (size === undefined || size === 0) return null
  try {
    return JSON.parse(new TextDecoder('utf-8').decode(fs.readRange(rel, 0, size)))
  } catch {
    return null
  }
}

async function writeJson(fs: JsonFs, rel: string, value: unknown): Promise<void> {
  const tmp = `${rel}.tmp`
  fs.writeFile(tmp, new TextEncoder().encode(JSON.stringify(value)))
  fs.remove(rel)
  await fs.move(tmp, rel)
}

/** Host side of `importQueue.load` / `importQueue.save`. */
export function createImportQueueService(fs: JsonFs) {
  return {
    load(): unknown {
      const value = readJson(fs, QUEUE_FILE)
      return value && typeof value === 'object' ? value : null
    },
    async save(raw: unknown): Promise<{ ok: true }> {
      const snapshot = (raw && typeof raw === 'object' ? (raw as { snapshot?: unknown }).snapshot : undefined) as
        | { version?: unknown; jobs?: unknown }
        | undefined
      if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.jobs)) {
        throw new HostServiceError('INVALID_ARGUMENT', 'snapshot must be { version: 1, jobs: [] }')
      }
      if (snapshot.jobs.length > QUEUE_LIMITS.maxJobs) throw new HostServiceError('INVALID_ARGUMENT', `at most ${QUEUE_LIMITS.maxJobs} jobs`)
      const text = JSON.stringify(snapshot)
      if (text.length > QUEUE_LIMITS.maxBytes) throw new HostServiceError('INVALID_ARGUMENT', `snapshot above ${QUEUE_LIMITS.maxBytes} bytes`)
      await writeJson(fs, QUEUE_FILE, snapshot)
      return { ok: true }
    },
  }
}

/** pickId of every job the saved snapshot still references (startup: other picks are dropped). */
export function snapshotPickIds(fs: JsonFs): Set<string> {
  const value = readJson(fs, QUEUE_FILE) as { jobs?: { source?: { kind?: string; pickId?: unknown } }[] } | null
  const ids = new Set<string>()
  for (const job of value?.jobs ?? []) if (job?.source?.kind === 'pick' && typeof job.source.pickId === 'string') ids.add(job.source.pickId)
  return ids
}

/** Persistence of the host's pick map (`files.pick` → `files.stage`), so picks survive a relaunch. */
export function createPickStore(fs: JsonFs) {
  let writing = Promise.resolve()
  return {
    load(): Map<string, PickedDocument> {
      const value = readJson(fs, PICKS_FILE)
      const map = new Map<string, PickedDocument>()
      if (value && typeof value === 'object') {
        for (const [id, p] of Object.entries(value as Record<string, PickedDocument>)) {
          if (p && typeof p.uri === 'string' && typeof p.name === 'string' && typeof p.size === 'number') map.set(id, p)
        }
      }
      return map
    },
    save(map: Map<string, PickedDocument>): void {
      const value = Object.fromEntries(map)
      writing = writing.then(() => writeJson(fs, PICKS_FILE, value)).catch(() => {})
    },
  }
}
