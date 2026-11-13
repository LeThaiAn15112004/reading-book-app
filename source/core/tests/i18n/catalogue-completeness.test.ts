import { describe, expect, it } from 'vitest'
import { AREA_IDS, EN_CATALOGUE, PENDING_VI_AREAS, VI_CATALOGUE } from '../../src/i18n/registry'
import { isPendingArea, pendingArea } from '../../src/i18n/pending'
import { isPluralMessage } from '../../src/i18n/translate'
import type { AreaShape } from '../../src/i18n/types'

/**
 * Spec 012 FR-015: every English area has a Vietnamese counterpart that is either COMPLETE (same keys, same
 * placeholders, same slot tags, no empty text) or an explicit `pendingArea(reason)` marker. Hard failure, not a warning.
 */

type Leaf = { path: string; value: string | { [form: string]: string } }

function leaves(node: unknown, prefix = ''): Leaf[] {
  if (typeof node === 'string' || isPluralMessage(node)) return [{ path: prefix, value: node as Leaf['value'] }]
  if (typeof node !== 'object' || node === null) throw new Error(`invalid catalogue node at ${prefix || '<root>'}`)
  return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
}

const placeholders = (s: string) => [...s.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]).sort()
const slots = (s: string) => [...s.matchAll(/<\/?([A-Za-z][A-Za-z0-9]*)>/g)].map((m) => m[0]).sort()
const texts = (v: Leaf['value']) => (typeof v === 'string' ? [v] : Object.values(v))

const enAreas = EN_CATALOGUE as Record<string, unknown>
const viAreas = VI_CATALOGUE as Record<string, unknown>

describe('catalogue completeness (spec 012 FR-015)', () => {
  it('both languages list exactly the same areas', () => {
    expect(Object.keys(viAreas).sort()).toEqual(Object.keys(enAreas).sort())
    expect(AREA_IDS.length).toBeGreaterThan(0)
  })

  it('area ids have one or two segments (the lookup relies on it)', () => {
    for (const area of AREA_IDS) expect(area.split('.').length).toBeLessThanOrEqual(2)
  })

  it('no English message is empty; English plurals have one + other', () => {
    for (const area of AREA_IDS) {
      for (const { path, value } of leaves(enAreas[area], area)) {
        for (const text of texts(value)) expect(text.trim(), path).not.toBe('')
        if (typeof value !== 'string') expect(Object.keys(value).sort(), path).toEqual(['one', 'other'])
        if (typeof value !== 'string') expect(texts(value).flatMap(placeholders), `${path}: a plural is chosen by {count}`).toContain('count')
      }
    }
  })

  for (const area of AREA_IDS) {
    it(`vi/${area}: complete, or an explicit pending marker with a reason`, () => {
      const vi = viAreas[area]
      if (isPendingArea(vi)) {
        expect(vi.reason.trim()).not.toBe('')
        return
      }
      const en = new Map(leaves(enAreas[area], area).map((l) => [l.path, l.value]))
      const viLeaves = leaves(vi, area)
      expect(viLeaves.map((l) => l.path).sort()).toEqual([...en.keys()].sort())
      for (const { path, value } of viLeaves) {
        const enValue = en.get(path)!
        expect(typeof value === 'string', `${path}: text vs plural`).toBe(typeof enValue === 'string')
        // Same placeholder SET (plural forms: union over the forms, since "one" may spell the number out).
        const set = (v: Leaf['value']) => [...new Set(texts(v).flatMap(placeholders))].sort()
        expect(set(value), `${path}: placeholders`).toEqual(set(enValue))
        for (const text of texts(value)) {
          expect(text.trim(), path).not.toBe('')
          expect(slots(text), `${path}: slot tags`).toEqual(slots(texts(enValue)[0]!))
        }
        if (typeof value !== 'string') expect(value.other, `${path}: other`).toBeTypeOf('string')
        // Vietnamese has no grammatical number: one form, chosen by `count` (spec 012 FR-011).
        if (typeof value !== 'string') expect(Object.keys(value), `${path}: vi plural forms`).toEqual(['other'])
      }
    })
  }

  it('PENDING_VI_AREAS is derived from the markers', () => {
    expect(PENDING_VI_AREAS.map((p) => p.area).sort()).toEqual(
      AREA_IDS.filter((a) => isPendingArea(viAreas[a])).sort(),
    )
    expect(PENDING_VI_AREAS.find((p) => p.area === 'common')).toBeUndefined()
  })

  it('pendingArea refuses an empty reason', () => {
    expect(() => pendingArea('')).toThrow()
    expect(() => pendingArea('   ')).toThrow()
  })

  it('AreaShape rejects missing and extra keys (compile-time)', () => {
    const en = { a: 'A', g: { b: 'B {x}' }, n: { one: '{count}', other: '{count}s' } } as const
    const ok = { a: 'a', g: { b: 'b {x}' }, n: { other: '{count}' } } satisfies AreaShape<typeof en>
    // @ts-expect-error — `g.b` missing
    const missing = { a: 'a', g: {}, n: { other: '' } } satisfies AreaShape<typeof en>
    // @ts-expect-error — extra key `z`
    const extra = { a: 'a', g: { b: 'b' }, n: { other: '' }, z: 'z' } satisfies AreaShape<typeof en>
    expect([ok, missing, extra]).toHaveLength(3)
  })
})
