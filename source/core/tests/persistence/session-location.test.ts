import { describe, expect, it } from 'vitest'
import {
  CfiLocation,
  Location,
  PageRectLocation,
  Rect,
  TextOffsetLocation,
} from '../../src/domain/reading/location.js'
import {
  IN_PROGRESS_LOCATION_LABEL,
  STARTED_LOCATION_LABEL,
  displayLabelFromStoredLocation,
  packSessionLocation,
  unpackSessionLocation,
} from '../../src/persistence/session-location.js'

describe('Location round-trip', () => {
  it.each<[string, Location]>([
    ['cfi', new CfiLocation('epubcfi(/6/4!/4/2/1:0)')],
    ['page-rect', new PageRectLocation(3, new Rect(1, 2, 3, 4))],
    ['page-rect without rect', new PageRectLocation(1)],
    ['text-offset', new TextOffsetLocation(42, 'spine:2')],
  ])('%s survives toString → parse', (_name, location) => {
    expect(Location.parse(location.toString()).equals(location)).toBe(true)
  })

  it('rejects invalid values', () => {
    expect(() => new CfiLocation('  ')).toThrow()
    expect(() => new PageRectLocation(0)).toThrow()
    expect(() => new TextOffsetLocation(-1)).toThrow()
    expect(() => Location.parse('{"kind":"nope"}')).toThrow()
  })
})

describe('packSessionLocation / unpackSessionLocation', () => {
  const location = new CfiLocation('epubcfi(/6/8!/4/2/1:5)')

  it('round-trips the location with a trimmed label', () => {
    const unpacked = unpackSessionLocation(packSessionLocation(location, '  Chapter 3  '))
    expect(unpacked?.location.equals(location)).toBe(true)
    expect(unpacked?.label).toBe('Chapter 3')
  })

  it('omits a blank label', () => {
    const packed = packSessionLocation(location, '   ')
    expect(JSON.parse(packed)).not.toHaveProperty('label')
    expect(unpackSessionLocation(packed)?.label).toBeUndefined()
  })

  it('returns undefined for legacy or malformed values', () => {
    expect(unpackSessionLocation('')).toBeUndefined()
    expect(unpackSessionLocation(STARTED_LOCATION_LABEL)).toBeUndefined()
    expect(unpackSessionLocation('not json')).toBeUndefined()
    expect(unpackSessionLocation('{"cfi":"x"}')).toBeUndefined()
  })
})

describe('displayLabelFromStoredLocation', () => {
  const location = new CfiLocation('epubcfi(/6/8!/4/2/1:5)')

  it('prefers the stored label, then a generic fallback', () => {
    expect(displayLabelFromStoredLocation(packSessionLocation(location, 'Chapter 3'))).toBe('Chapter 3')
    expect(displayLabelFromStoredLocation(packSessionLocation(location))).toBe(IN_PROGRESS_LOCATION_LABEL)
  })

  it('never leaks raw JSON and keeps legacy free text', () => {
    expect(displayLabelFromStoredLocation('{"foo":1}')).toBeUndefined()
    expect(displayLabelFromStoredLocation(STARTED_LOCATION_LABEL)).toBe(STARTED_LOCATION_LABEL)
    expect(displayLabelFromStoredLocation('Page 12')).toBe('Page 12')
    expect(displayLabelFromStoredLocation('')).toBeUndefined()
  })
})
