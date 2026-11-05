import { describe, expect, it } from 'vitest'
import {
  cfiChapterSignature,
  cfiRangesOverlap,
  spineIndexFromCfiPath,
  splitCfiRange,
  splitTopLevelCommas,
} from '../../src/app-utils/epub-cfi.js'

describe('splitTopLevelCommas', () => {
  it('splits on top-level commas only', () => {
    expect(splitTopLevelCommas('/6/4[a,b]!/4,/1:0,/1:9')).toEqual(['/6/4[a,b]!/4', '/1:0', '/1:9'])
  })

  it('drops empty parts', () => {
    expect(splitTopLevelCommas(',a,,b,')).toEqual(['a', 'b'])
  })
})

describe('cfiChapterSignature', () => {
  it('reduces a range CFI and a bare cfiBase to the same signature', () => {
    expect(cfiChapterSignature('epubcfi(/6/60[ch5]!/4/2,/1:0,/1:9)')).toBe('/6/60')
    expect(cfiChapterSignature('/6/60')).toBe('/6/60')
  })

  it('returns null for blank input', () => {
    expect(cfiChapterSignature('   ')).toBeNull()
  })
})

describe('spineIndexFromCfiPath', () => {
  it('maps the even spine step to a zero-based index', () => {
    expect(spineIndexFromCfiPath('epubcfi(/6/2!/4/2)')).toBe(0)
    expect(spineIndexFromCfiPath('epubcfi(/6/60[ch5]!/4/2)')).toBe(29)
  })

  it('rejects odd or too-short paths', () => {
    expect(spineIndexFromCfiPath('epubcfi(/6/3!/4)')).toBeUndefined()
    expect(spineIndexFromCfiPath('/6')).toBeUndefined()
  })
})

describe('splitCfiRange', () => {
  it('splits an epubjs range into start/end CFIs sharing the base', () => {
    expect(splitCfiRange('epubcfi(/6/4!/4/2,/1:0,/1:9)')).toEqual({
      locationStart: 'epubcfi(/6/4!/4/2,/1:0)',
      locationEnd: 'epubcfi(/6/4!/4/2,/1:9)',
    })
  })

  it('falls back to the whole string for non-range input', () => {
    expect(splitCfiRange('epubcfi(/6/4!/4/2/1:0)')).toEqual({
      locationStart: 'epubcfi(/6/4!/4/2/1:0)',
      locationEnd: 'epubcfi(/6/4!/4/2/1:0)',
    })
    expect(splitCfiRange('')).toEqual({ locationStart: '', locationEnd: '' })
  })
})

describe('cfiRangesOverlap', () => {
  it('detects identical ranges and shared endpoints', () => {
    const a = 'epubcfi(/6/4!/4/2,/1:0,/1:9)'
    expect(cfiRangesOverlap(a, a)).toBe(true)
    expect(cfiRangesOverlap(a, 'epubcfi(/6/4!/4/2,/1:9,/1:20)')).toBe(true)
  })

  it('treats ranges in different chapters as disjoint', () => {
    expect(
      cfiRangesOverlap('epubcfi(/6/4!/4/2,/1:0,/1:9)', 'epubcfi(/6/8!/4/2,/1:0,/1:9)'),
    ).toBe(false)
  })

  it('never overlaps with a blank range', () => {
    expect(cfiRangesOverlap('', 'epubcfi(/6/4!/4/2,/1:0,/1:9)')).toBe(false)
  })
})
