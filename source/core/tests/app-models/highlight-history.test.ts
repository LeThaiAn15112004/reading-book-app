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

describe('dropWhere', () => {
  const touches = (id: string) => (a: { kind: string; before?: Row; after?: Row; value?: Row }) =>
    a.kind === 'replace' ? a.before!.id === id || a.after!.id === id : a.value!.id === id

  it('removes a row’s steps from both stacks so the steps behind them stay reachable', () => {
    const h = createHighlightHistory<Row>()
    h.push(highlightReplace({ id: 'keep', v: 0 }, { id: 'keep', v: 1 }))
    h.push(highlightReplace({ id: 'gone', v: 0 }, { id: 'gone', v: 1 }))
    h.push(highlightReplace({ id: 'gone', v: 1 }, { id: 'gone', v: 2 }))
    h.undo() // the last 'gone' step is now on the redo side
    h.dropWhere(touches('gone'))
    expect(h.canRedo()).toBe(false)
    expect(h.undo()).toEqual({ kind: 'replace', before: { id: 'keep', v: 0 }, after: { id: 'keep', v: 1 } })
    expect(h.undo()).toBeNull()
  })

  it('a drop never merges the next push into an older step', () => {
    vi.useFakeTimers()
    const h = createHighlightHistory<Row>()
    h.push(highlightReplace({ id: 'a', v: 0 }, { id: 'a', v: 1 }), 'size')
    h.dropWhere(() => false)
    h.push(highlightReplace({ id: 'a', v: 1 }, { id: 'a', v: 2 }), 'size')
    expect(h.undo()).toEqual({ kind: 'replace', before: { id: 'a', v: 1 }, after: { id: 'a', v: 2 } })
    vi.useRealTimers()
  })
})
