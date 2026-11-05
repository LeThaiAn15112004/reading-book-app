import { describe, expect, it } from 'vitest'
import { applyHistoryStep, createUndoHistory, type HistoryAction } from '../../src/annotations/history.js'

type Row = { id: string; v: number }

function recorder() {
  const log: string[] = []
  return {
    log,
    handlers: {
      restore: (r: Row) => {
        log.push(`restore:${r.id}:${r.v}`)
      },
      remove: (r: Row) => {
        log.push(`remove:${r.id}`)
      },
    },
  }
}

describe('undo history', () => {
  it('undoes and redoes, and a new push clears redo', () => {
    const h = createUndoHistory<Row>()
    h.push({ kind: 'add', value: { id: 'a', v: 1 } })
    expect(h.canUndo()).toBe(true)
    expect(h.undo()).toEqual({ kind: 'add', value: { id: 'a', v: 1 } })
    expect(h.canRedo()).toBe(true)
    h.push({ kind: 'remove', value: { id: 'b', v: 1 } })
    expect(h.canRedo()).toBe(false)
  })

  it('batch: undo applies the inverses in reverse order, redo in order', () => {
    const batch: HistoryAction<Row> = {
      kind: 'batch',
      actions: [
        { kind: 'remove', value: { id: 'a', v: 1 } },
        { kind: 'replace', before: { id: 'b', v: 1 }, after: { id: 'b', v: 2 } },
        { kind: 'add', value: { id: 'c', v: 1 } },
      ],
    }
    const undo = recorder()
    applyHistoryStep(batch, 'undo', undo.handlers)
    expect(undo.log).toEqual(['remove:c', 'restore:b:1', 'restore:a:1'])
    const redo = recorder()
    applyHistoryStep(batch, 'redo', redo.handlers)
    expect(redo.log).toEqual(['remove:a', 'restore:b:2', 'restore:c:1'])
  })

  it('a batch is one undo step and the limit drops the oldest entry', () => {
    const h = createUndoHistory<Row>(2)
    h.push({ kind: 'add', value: { id: 'a', v: 1 } })
    h.push({
      kind: 'batch',
      actions: [
        { kind: 'add', value: { id: 'b', v: 1 } },
        { kind: 'add', value: { id: 'c', v: 1 } },
      ],
    })
    h.push({ kind: 'add', value: { id: 'd', v: 1 } })
    expect(h.undo()?.kind).toBe('add')
    expect(h.undo()?.kind).toBe('batch')
    expect(h.undo()).toBeNull()
  })
})
