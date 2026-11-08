// Spec 010 T050 — the marker and the launch decision (data-model §5).
import { describe, expect, it } from 'vitest'
import { decideOnLaunch, parseMarker, type LaunchFacts, type StoreImportMarker } from '../../src/store-import/index.js'

const marker = (state: StoreImportMarker['state']): StoreImportMarker => ({ version: 1, state, at: '2026-11-08T10:00:00.000Z' })
const facts = (over: Partial<LaunchFacts>): LaunchFacts => ({
  storeDbExists: false,
  marker: null,
  sourceDbExists: true,
  storeLibraryEmpty: true,
  ...over,
})

describe('decideOnLaunch', () => {
  it('no Store db + no marker + source → offer', () => {
    expect(decideOnLaunch(facts({}))).toBe('offer')
  })
  it('no Store db + declined → none', () => {
    expect(decideOnLaunch(facts({ marker: marker('declined') }))).toBe('none')
  })
  it('no Store db + done → none (final for the automatic offer)', () => {
    expect(decideOnLaunch(facts({ marker: marker('done') }))).toBe('none')
  })
  it('no Store db + pending → importWithoutAsking', () => {
    expect(decideOnLaunch(facts({ marker: marker('pending') }))).toBe('importWithoutAsking')
  })
  it('Store db exists + pending + empty library (Settings entry after "Start empty") → importWithoutAsking', () => {
    expect(decideOnLaunch(facts({ storeDbExists: true, marker: marker('pending'), storeLibraryEmpty: true }))).toBe('importWithoutAsking')
  })
  it('Store db exists + pending + books in the library → none', () => {
    expect(decideOnLaunch(facts({ storeDbExists: true, marker: marker('pending'), storeLibraryEmpty: false }))).toBe('none')
  })
  it('Store db exists → none with any other marker', () => {
    for (const m of [null, marker('declined'), marker('done')]) {
      expect(decideOnLaunch(facts({ storeDbExists: true, marker: m }))).toBe('none')
    }
  })
  it('no source → none, whatever else', () => {
    for (const m of [null, marker('pending'), marker('declined'), marker('done')]) {
      expect(decideOnLaunch(facts({ sourceDbExists: false, marker: m }))).toBe('none')
    }
  })
})

describe('parseMarker', () => {
  it('reads a minimal marker from text or value', () => {
    expect(parseMarker('{"version":1,"state":"declined","at":"2026-11-08T10:00:00.000Z"}')).toEqual(marker('declined'))
    expect(parseMarker(marker('pending'))).toEqual(marker('pending'))
  })
  it('keeps valid source / copied details of a done marker', () => {
    const done = {
      ...marker('done'),
      source: { schemaMigrations: 30, lastMigration: '030_audio_transcript_scope.sql' },
      copied: { books: 12, notes: 340, files: 57, bytes: 123456 },
    }
    expect(parseMarker(JSON.stringify(done))).toEqual(done)
  })
  it('drops malformed details but keeps the state', () => {
    expect(parseMarker({ ...marker('done'), copied: { books: -1 } })).toEqual(marker('done'))
  })
  it('treats unknown states, other versions and broken JSON as absent', () => {
    expect(parseMarker({ version: 1, state: 'importing', at: 'x' })).toBeNull()
    expect(parseMarker({ version: 2, state: 'done', at: 'x' })).toBeNull()
    expect(parseMarker({ version: 1, state: 'done', at: '' })).toBeNull()
    expect(parseMarker('{not json')).toBeNull()
    expect(parseMarker(null)).toBeNull()
    expect(parseMarker('"done"')).toBeNull()
  })
})
