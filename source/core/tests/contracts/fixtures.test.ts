/**
 * The contract fixtures themselves (spec 008, T036): versioned, one per stored kind, and valid by the SDK's own
 * parsers, the same ones Desktop's Main uses to re-validate a save. A fixture the parsers would reshape is not a
 * real Desktop row.
 */
import { describe, expect, it } from 'vitest'
import { Location, parseMdAnnotation, parsePdfAnnotation, parseReadingState, parseTxtAnnotation, unpackSessionLocation } from '../../src/index.js'
import { canonical } from './contract-runner.js'
import { CONTRACT_VERSION, loadContractFixtures } from './fixtures.js'

const fixtures = loadContractFixtures()
type Obj = Record<string, unknown>

describe('contract fixtures v1', () => {
  it('cover every kind the first release stores', () => {
    expect(fixtures.map((f) => f.kind).sort()).toEqual([
      'book-epub', 'epub-bookmark', 'epub-highlight', 'md-highlight', 'pdf-bookmark', 'pdf-highlight', 'reading-state-epub', 'reading-state-txt', 'txt-underline',
    ])
    for (const f of fixtures) expect(f.contractVersion).toBe(CONTRACT_VERSION)
  })

  for (const f of fixtures) {
    if (!('expect' in f) || !('noteJson' in f.expect)) continue
    const note = f.expect.noteJson as Obj
    it(`${f.kind}: the locator parses as a Location`, () => {
      const locator = (note.locatorExtended as Obj).locator
      expect(() => Location.parse(JSON.stringify(locator))).not.toThrow()
    })
    it(`${f.kind}: format payloads are unchanged by the SDK parsers`, () => {
      if (note.pdfAnnotation) expect(canonical(parsePdfAnnotation(note.pdfAnnotation, undefined))).toBe(canonical(note.pdfAnnotation))
      if (note.mdAnnotation) expect(canonical(parseMdAnnotation(note.mdAnnotation))).toBe(canonical(note.mdAnnotation))
      if (note.txtAnnotation) expect(canonical(parseTxtAnnotation(note.txtAnnotation))).toBe(canonical(note.txtAnnotation))
    })
  }

  for (const f of fixtures) {
    if (!('session' in f)) continue
    it(`${f.kind}: the stored state parses and its location unpacks with its label`, () => {
      const state = f.expect.readingStateJson as Obj
      const stored = JSON.stringify({ ...state, lastReadLocation: JSON.stringify(state.lastReadLocation) })
      const parsed = parseReadingState(stored)
      const unpacked = unpackSessionLocation(parsed.lastReadLocation ?? '')
      expect(unpacked?.label).toBe(f.session.lastReadLabel)
    })
  }
})
