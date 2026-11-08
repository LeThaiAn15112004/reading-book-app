// Spec 010 T047 — planStoreImport: allowlist, refusals (contracts/store-import.md "Allowlist", data-model §6).
import { describe, expect, it } from 'vitest'
import { STORE_IMPORT_ALLOWLIST, planStoreImport, type StoreImportSourceEntry } from '../../src/store-import/index.js'

const ALLOWED: StoreImportSourceEntry[] = [
  { name: 'reading-book.db', kind: 'file', bytes: 1000 },
  { name: 'books', kind: 'dir', bytes: 5000 },
  { name: 'covers', kind: 'dir', bytes: 300 },
  { name: 'txt-edits', kind: 'dir', bytes: 200 },
  { name: 'background-prefs.json', kind: 'file', bytes: 10 },
  { name: 'notification-prefs.json', kind: 'file', bytes: 10 },
  { name: 'reading-reminder-state.json', kind: 'file', bytes: 10 },
  { name: 'Local Storage', kind: 'dir', bytes: 70 },
]
const NEVER: StoreImportSourceEntry[] = [
  { name: 'cloud-tokens', kind: 'file', bytes: 1 },
  { name: 'models', kind: 'dir', bytes: 900_000 },
  { name: 'transcription-models', kind: 'dir', bytes: 900_000 },
  { name: 'attachment-tmp', kind: 'dir', bytes: 1 },
  { name: 'attachment-staging', kind: 'dir', bytes: 1 },
  { name: 'zip-import-tmp', kind: 'dir', bytes: 1 },
  { name: 'Cache', kind: 'dir', bytes: 1 },
  { name: 'GPUCache', kind: 'dir', bytes: 1 },
  { name: 'Session Storage', kind: 'dir', bytes: 1 },
  { name: 'something-new.json', kind: 'file', bytes: 1 },
]
const source = (entries: StoreImportSourceEntry[], hasWal = false) => ({ root: 'C:\\src', entries, hasWal })
const PLENTY = 10 ** 12

describe('planStoreImport', () => {
  it('copies exactly the allowlisted entries, in allowlist order', () => {
    const plan = planStoreImport(source([...NEVER, ...[...ALLOWED].reverse()]), { freeBytes: PLENTY })
    expect(plan?.copy).toEqual(STORE_IMPORT_ALLOWLIST.map((e) => e.name))
    expect(plan?.totalBytes).toBe(6600)
    expect(plan?.refuse).toBeUndefined()
  })

  it('skips cloud-tokens, models, temporary folders, Chromium caches and unknown entries', () => {
    const plan = planStoreImport(source([...ALLOWED, ...NEVER]), { freeBytes: PLENTY })
    expect(plan?.skip).toEqual(NEVER.map((e) => e.name).sort())
  })

  it('skips an allowlisted name of the wrong kind (a folder called reading-book.db is not the database)', () => {
    const plan = planStoreImport(source([{ name: 'reading-book.db', kind: 'dir', bytes: 1 }]), { freeBytes: PLENTY })
    expect(plan).toBeNull()
  })

  it('matches names case-insensitively (Windows)', () => {
    const plan = planStoreImport(source([{ name: 'READING-BOOK.DB', kind: 'file', bytes: 1 }, { name: 'local storage', kind: 'dir', bytes: 1 }]), {
      freeBytes: PLENTY,
    })
    expect(plan?.copy).toEqual(['READING-BOOK.DB', 'local storage'])
  })

  it('returns null without a library database', () => {
    expect(planStoreImport(source(ALLOWED.slice(1)), { freeBytes: PLENTY })).toBeNull()
  })

  it('refuses source_busy when the WAL file exists', () => {
    expect(planStoreImport(source(ALLOWED, true), { freeBytes: PLENTY })?.refuse).toBe('source_busy')
  })

  it('source_busy wins over no_space', () => {
    expect(planStoreImport(source(ALLOWED, true), { freeBytes: 0 })?.refuse).toBe('source_busy')
  })

  it('refuses no_space when free space is below total + 10 %', () => {
    // total 6600 → needs 7260
    expect(planStoreImport(source(ALLOWED), { freeBytes: 7259 })?.refuse).toBe('no_space')
    const ok = planStoreImport(source(ALLOWED), { freeBytes: 7260 })
    expect(ok?.refuse).toBeUndefined()
    expect(ok?.neededBytes).toBe(7260)
  })
})
