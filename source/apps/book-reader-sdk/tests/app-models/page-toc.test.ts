import { describe, expect, it } from 'vitest'
import { resolveActivePageTocEntry } from '../../src/app-models/page-toc.js'

type Entry = { id: string; page: number | null; children: Entry[] }

const e = (id: string, page: number | null, children: Entry[] = []): Entry => ({ id, page, children })
const pageOf = (item: Entry) => item.page
const activeId = (items: Entry[], page: number, preferred?: string | null) =>
  resolveActivePageTocEntry(items, page, pageOf, preferred)?.id ?? null

// Part 1 (p1) > 1.1 (p2), 1.2 (p4) ; Part 2 (p6) > 2.1 (p6), 2.2 (p8)
const nested = [
  e('part1', 1, [e('s1.1', 2), e('s1.2', 4)]),
  e('part2', 6, [e('s2.1', 6), e('s2.2', 8)]),
]

describe('resolveActivePageTocEntry', () => {
  it('returns null for an empty TOC', () => {
    expect(activeId([], 3)).toBeNull()
  })

  it('returns null before the first destination', () => {
    expect(activeId([e('a', 3), e('b', 5)], 2)).toBeNull()
  })

  it('matches an exact destination page', () => {
    expect(activeId([e('a', 3), e('b', 5)], 5)).toBe('b')
  })

  it('keeps the previous entry while between two destinations', () => {
    expect(activeId([e('a', 3), e('b', 5)], 4)).toBe('a')
  })

  it('resolves nested entries: parent until its first child starts, then the child', () => {
    expect(activeId(nested, 1)).toBe('part1')
    expect(activeId(nested, 2)).toBe('s1.1')
    expect(activeId(nested, 3)).toBe('s1.1')
    expect(activeId(nested, 5)).toBe('s1.2')
  })

  it('does not activate a sibling just because its page is near', () => {
    expect(activeId(nested, 7)).toBe('s2.1')
    expect(activeId(nested, 7)).not.toBe('s2.2')
  })

  it('picks the last entry in document order when several share a page', () => {
    // part2 and s2.1 are both on page 6 → the child (more specific) wins
    expect(activeId(nested, 6)).toBe('s2.1')
    expect(activeId([e('a', 5), e('b', 5), e('c', 5)], 5)).toBe('c')
  })

  it('honours a preferred (clicked) entry only when it is on the winning page', () => {
    expect(activeId([e('a', 5), e('b', 5)], 5, 'a')).toBe('a')
    expect(activeId(nested, 6, 'part2')).toBe('part2')
    // preferred entry is on an earlier page than the winner → ignored
    expect(activeId([e('a', 3), e('b', 5)], 5, 'a')).toBe('b')
    // preferred entry is after the current page → ignored
    expect(activeId([e('a', 3), e('b', 5)], 4, 'b')).toBe('a')
    expect(activeId([e('a', 3)], 3, 'missing')).toBe('a')
  })

  it('skips missing or invalid destinations without treating them as page 1', () => {
    const items = [e('nodest', null), e('zero', 0), e('neg', -2), e('frac', 1.5), e('nan', Number.NaN), e('ok', 3)]
    expect(activeId(items, 1)).toBeNull()
    expect(activeId(items, 2)).toBeNull()
    expect(activeId(items, 3)).toBe('ok')
  })

  it('still resolves children of an entry without a destination', () => {
    const items = [e('group', null, [e('child', 2)])]
    expect(activeId(items, 1)).toBeNull()
    expect(activeId(items, 2)).toBe('child')
  })

  it('returns null for an invalid current page', () => {
    expect(activeId(nested, 0)).toBeNull()
    expect(activeId(nested, Number.NaN)).toBeNull()
    expect(activeId(nested, 2.5)).toBeNull()
  })

  it('changes the active entry as the current page changes', () => {
    const seen = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((page) => activeId(nested, page))
    expect(seen).toEqual(['part1', 's1.1', 's1.1', 's1.2', 's1.2', 's2.1', 's2.1', 's2.2', 's2.2'])
  })

  it('is deterministic across repeated calls and does not mutate the TOC', () => {
    const snapshot = JSON.stringify(nested)
    const first = resolveActivePageTocEntry(nested, 6, pageOf)
    for (let i = 0; i < 5; i += 1) expect(resolveActivePageTocEntry(nested, 6, pageOf)).toBe(first)
    expect(JSON.stringify(nested)).toBe(snapshot)
  })

  it('handles non-monotonic outlines by page, not by position', () => {
    // An appendix listed first but pointing at the end must not win on early pages.
    const items = [e('appendix', 9), e('intro', 1), e('body', 4)]
    expect(activeId(items, 5)).toBe('body')
    expect(activeId(items, 9)).toBe('appendix')
  })
})
