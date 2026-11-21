/**
 * Spec 016 (T045, FR-013b, contracts/phone-host.md): the phone's saved import queue and picks on the host.
 */
import { describe, expect, it } from 'vitest'
import { createFileService } from '../host/file-service'
import { createImportQueueService, createPickStore, PICKS_FILE, QUEUE_FILE, QUEUE_LIMITS, snapshotPickIds } from '../host/import-queue-file'
import { MemoryFs } from './fake-host'

const job = (id: string, pickId: string, state = 'waiting') => ({
  id,
  batchId: null,
  source: { kind: 'pick', pickId },
  name: `${id}.pdf`,
  sizeBytes: 1,
  state,
  queuedAt: 1,
})

const readJson = (fs: MemoryFs, rel: string) => JSON.parse(new TextDecoder().decode(fs.files.get(rel)!))

describe('importQueue.save / load (spec 016)', () => {
  it('round-trips a snapshot through import-queue.json (temp file + move, no temp left)', async () => {
    const fs = new MemoryFs()
    const service = createImportQueueService(fs)
    expect(service.load()).toBeNull()
    const snapshot = { version: 1, jobs: [job('a', 'p1', 'running'), job('b', 'p2')] }
    await service.save({ snapshot })
    expect(service.load()).toEqual(snapshot)
    expect(fs.paths()).toEqual([QUEUE_FILE])
  })

  it('refuses a bad shape and the limits: ≤ 200 jobs, ≤ 256 KiB', async () => {
    const service = createImportQueueService(new MemoryFs())
    await expect(service.save({ snapshot: { version: 2, jobs: [] } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    const many = Array.from({ length: QUEUE_LIMITS.maxJobs + 1 }, (_, i) => job(`j${i}`, `p${i}`))
    await expect(service.save({ snapshot: { version: 1, jobs: many } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    const huge = [{ ...job('a', 'p'), name: 'x'.repeat(QUEUE_LIMITS.maxBytes) }]
    await expect(service.save({ snapshot: { version: 1, jobs: huge } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('a damaged file loads as nothing (the app starts with an empty queue)', () => {
    const fs = new MemoryFs()
    fs.writeFile(QUEUE_FILE, new TextEncoder().encode('{ not json'))
    expect(createImportQueueService(fs).load()).toBeNull()
  })
})

describe('picks across a relaunch (spec 016)', () => {
  it('keeps the pick map in import-picks.json (host only) and reports whether a pick is still readable', async () => {
    const fs = new MemoryFs()
    const store = createPickStore(fs)
    const files = createFileService({ fs, devChunks: false, pickStore: store })
    fs.queuePick('Book.pdf', 'pdf-bytes')
    fs.queuePick('notes.docx', 'x')
    const picked = (await files.pick!({ extensions: ['pdf'], multiple: true })) as { status: string; items: { pickId: string; extension: string | null }[] }
    // `pickDocuments` is absent in MemoryFs: one file per pick.
    expect(picked.status).toBe('picked')
    const pickId = picked.items[0]!.pickId
    await new Promise((r) => setTimeout(r, 0))
    expect(Object.keys(readJson(fs, PICKS_FILE))).toEqual([pickId])

    // A new host process loads the saved picks.
    const relaunched = createFileService({ fs, devChunks: false, pickStore: createPickStore(fs) })
    expect(relaunched.checkPick!({ pickId })).toMatchObject({ readable: true, name: 'Book.pdf', extension: 'pdf' })
    expect(relaunched.checkPick!({ pickId: 'unknown' })).toEqual({ readable: false })
  })

  it('a pick the system no longer lets the app read is reported unreadable', async () => {
    const fs = new MemoryFs()
    ;(fs as unknown as { uriReadable: (uri: string) => boolean }).uriReadable = () => false
    const files = createFileService({ fs, devChunks: false, pickStore: createPickStore(fs) })
    fs.queuePick('Book.pdf', 'pdf')
    const picked = (await files.pick!({ extensions: ['pdf'] })) as { pickId: string }
    expect(files.checkPick!({ pickId: picked.pickId })).toMatchObject({ readable: false })
  })

  it('snapshotPickIds lists only the picks the saved queue still uses (others are dropped at startup)', async () => {
    const fs = new MemoryFs()
    await createImportQueueService(fs).save({ snapshot: { version: 1, jobs: [job('a', 'keep-me'), { ...job('u', ''), source: { kind: 'url', url: 'https://x' } }] } })
    expect([...snapshotPickIds(fs)]).toEqual(['keep-me'])
  })

  it('multi-pick: at most 50 per pick, unsupported files get no pick id', async () => {
    const fs = new MemoryFs()
    const docs = Array.from({ length: 52 }, (_, i) => ({ uri: `file:///c/${i}`, name: i === 0 ? 'a.docx' : `b${i}.pdf`, size: 1 }))
    ;(fs as unknown as { pickDocuments: () => Promise<typeof docs> }).pickDocuments = async () => docs
    const files = createFileService({ fs, devChunks: false })
    const picked = (await files.pick!({ extensions: ['pdf'], multiple: true })) as {
      items: { pickId: string; extension: string | null }[]
      notAdded: number
    }
    expect(picked.items).toHaveLength(50)
    expect(picked.notAdded).toBe(2)
    expect(picked.items[0]).toMatchObject({ pickId: '', extension: null })
    expect(picked.items.slice(1).every((i) => i.pickId && i.extension === 'pdf')).toBe(true)
  })
})
