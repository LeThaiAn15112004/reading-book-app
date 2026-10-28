import { afterEach, describe, expect, it, vi } from 'vitest'
import { COALESCE_WINDOW_MS, createHighlightHistory, highlightReplace } from '../../src/app-models/highlight-history.js'

type Row = { id: string; v: number }

describe('history coalescing', () => {
  afterEach(() => vi.useRealTimers())

  it('merges same-key replaces on one row into a single undo step', () => {
    vi.useFakeTimers()
    const h = createHighlightHistory<Row>()
    h.push(highlightReplace({ id: 'a', v: 0 }, { id: 'a', v: 1 }), 'size')
    h.push(highlightReplace({ id: 'a', v: 1 }, { id: 'a', v: 2 }), 'size')
    expect(h.undo()).toEqual({ kind: 'replace', before: { id: 'a', v: 0 }, after: { id: 'a', v: 2 } })
    expect(h.undo()).toBeNull()
  })

  it('does not merge different keys, other rows, a late push, or without a key', () => {
    vi.useFakeTimers()
    const h = createHighlightHistory<Row>()
    h.push(highlightReplace({ id: 'a', v: 0 }, { id: 'a', v: 1 }), 'size')
    h.push(highlightReplace({ id: 'a', v: 1 }, { id: 'a', v: 2 }), 'color')
    h.push(highlightReplace({ id: 'b', v: 0 }, { id: 'b', v: 1 }), 'color')
    vi.advanceTimersByTime(COALESCE_WINDOW_MS + 1)
    h.push(highlightReplace({ id: 'b', v: 1 }, { id: 'b', v: 2 }), 'color')
    h.push(highlightReplace({ id: 'b', v: 2 }, { id: 'b', v: 3 }))
    let n = 0
    while (h.undo()) n++
    expect(n).toBe(5)
  })
})
