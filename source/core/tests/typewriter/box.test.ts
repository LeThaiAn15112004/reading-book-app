import { describe, expect, it } from 'vitest'
import { moveTypewriterBox, resizeTypewriterBox, typewriterBoxAt, TYPEWRITER_MIN_BOX_WIDTH } from '../../src/typewriter/index.js'

const box = { x: 0.2, y: 0.3, width: 0.4, height: 0.1 }
// the text needs 0.06 at width >= 0.3, grows as the box narrows
const need = (w: number) => (w >= 0.3 ? 0.06 : 0.06 * (0.3 / w))

describe('moveTypewriterBox', () => {
  it('moves and stays inside the page', () => {
    const m = moveTypewriterBox(box, 0.1, 0.1)
    expect(m.x).toBeCloseTo(0.3)
    expect(m.y).toBeCloseTo(0.4)
    expect(moveTypewriterBox(box, 5, 5)).toEqual({ ...box, x: 0.6, y: 0.9 })
    expect(moveTypewriterBox(box, -5, -5)).toEqual({ ...box, x: 0, y: 0 })
  })
})

describe('resizeTypewriterBox', () => {
  it('east / west change the width and keep the opposite edge, down to the minimum', () => {
    expect(resizeTypewriterBox(box, 'e', 0.1, 0, need).width).toBeCloseTo(0.5)
    const w = resizeTypewriterBox(box, 'w', 0.1, 0, need)
    expect(w.x).toBeCloseTo(0.3)
    expect(w.x + w.width).toBeCloseTo(0.6)
    expect(resizeTypewriterBox(box, 'e', -5, 0, need).width).toBe(TYPEWRITER_MIN_BOX_WIDTH)
    expect(resizeTypewriterBox(box, 'e', 5, 0, need).width).toBeCloseTo(0.8)
  })

  it('never makes the box shorter than the text needs', () => {
    expect(resizeTypewriterBox(box, 's', -5, -5, need).height).toBeCloseTo(0.06)
    // narrowing grows the minimum height and the box follows
    const narrow = resizeTypewriterBox(box, 'e', -0.3, 0, need)
    expect(narrow.height).toBeGreaterThanOrEqual(need(narrow.width) - 1e-9)
  })

  it('north keeps the bottom edge; the box stays inside the page', () => {
    const n = resizeTypewriterBox(box, 'n', 0, -0.1, need)
    expect(n.y + n.height).toBeCloseTo(0.4)
    expect(n.height).toBeCloseTo(0.2)
    expect(resizeTypewriterBox(box, 'n', 0, -5, need).y).toBe(0)
    const s = resizeTypewriterBox(box, 's', 5, 5, need)
    expect(s.y + s.height).toBeLessThanOrEqual(1 + 1e-9)
  })
})

describe('typewriterBoxAt', () => {
  it('returns the topmost box under the point', () => {
    const a = { id: 'a', box }
    const b = { id: 'b', box: { ...box, x: 0.3 } }
    expect(typewriterBoxAt([a, b], 0.35, 0.35)?.id).toBe('b')
    expect(typewriterBoxAt([a, b], 0.21, 0.35)?.id).toBe('a')
    expect(typewriterBoxAt([a, b], 0.9, 0.9)).toBeNull()
    expect(typewriterBoxAt([a], 0.19, 0.35, 0.02)?.id).toBe('a')
  })
})
