import { describe, expect, it } from 'vitest'
import {
  addTxtHighlight,
  canRedoTxt,
  canUndoTxt,
  createTxtDocument,
  deriveTextEdit,
  editTxtDocument,
  redoTxtDocument,
  removeTxtHighlight,
  setTxtReadingOffset,
  undoTxtDocument,
  updateTxtHighlight,
  TXT_COALESCE_MS,
  type TextEdit,
  type TxtDocument,
} from '../../src/txt/index.js'
import { highlightOf, makeHighlight, randomInt, rng, SAMPLE_TEXT } from './txt-fixtures.js'

const edit = (start: number, deleteLength: number, insert: string): TextEdit => ({ start, deleteLength, insert })
const sel = (n: number) => ({ start: n, end: n })

/** Apply `e` the way the editor does, one second per step unless `at` is given. */
function apply(doc: TxtDocument, e: TextEdit, at = 0) {
  return editTxtDocument(doc, e, { now: at, selectionBefore: sel(e.start), selectionAfter: sel(e.start + e.insert.length) })
}

describe('editTxtDocument', () => {
  it('applies the edit, moves later annotations, keeps earlier ones, removes touched ones', () => {
    const before = highlightOf(SAMPLE_TEXT, 'Khởi đầu')
    const middle = highlightOf(SAMPLE_TEXT, 'công viên')
    const after = highlightOf(SAMPLE_TEXT, 'needle')
    const doc = createTxtDocument(SAMPLE_TEXT, [before, middle, after])

    // Insert INSIDE the middle annotation.
    const at = middle.startOffset + 3
    const { doc: next, removed } = apply(doc, edit(at, 0, 'ZZZ'))
    expect(removed.map((h) => h.id)).toEqual([middle.id])
    expect(next.highlights.map((h) => h.id)).toEqual([before.id, after.id])
    expect(next.highlights[0]).toEqual(before)
    expect(next.highlights[1]!.startOffset).toBe(after.startOffset + 3)
    expect(next.text.slice(next.highlights[1]!.startOffset, next.highlights[1]!.endOffset)).toBe('needle')
    expect(JSON.parse(next.highlights[1]!.locatorRef).offset).toBe(after.startOffset + 3)
  })

  it('an edit before every annotation keeps them all and moves them; one after them touches none', () => {
    const rows = [highlightOf(SAMPLE_TEXT, 'Trời hôm nay'), highlightOf(SAMPLE_TEXT, 'needle')]
    const doc = createTxtDocument(SAMPLE_TEXT, rows)
    const front = apply(doc, edit(0, 0, '>>> ')).doc
    expect(front.highlights.map((h) => h.startOffset)).toEqual(rows.map((h) => h.startOffset + 4))
    const tail = apply(doc, edit(SAMPLE_TEXT.length, 0, '\nEND')).doc
    expect(tail.highlights).toEqual(rows)
  })

  it('moves the reading position with the text it points at', () => {
    const doc = createTxtDocument(SAMPLE_TEXT, [], 40)
    expect(apply(doc, edit(0, 0, '1234567890')).doc.readingOffset).toBe(50)
    expect(apply(doc, edit(60, 0, 'x')).doc.readingOffset).toBe(40)
    expect(apply(doc, edit(30, 20, '')).doc.readingOffset).toBe(30)
  })

  it('ignores a no-op edit (no history entry)', () => {
    const doc = createTxtDocument('abc')
    const result = apply(doc, edit(1, 0, ''))
    expect(result.doc).toBe(doc)
    expect(canUndoTxt(result.doc)).toBe(false)
  })
})

describe('undo / redo of edits', () => {
  it('undo restores text and the annotations the edit removed, redo removes them again', () => {
    const a = highlightOf(SAMPLE_TEXT, 'Trời hôm nay')
    const b = highlightOf(SAMPLE_TEXT, 'needle')
    const doc0 = createTxtDocument(SAMPLE_TEXT, [a, b])
    const del = edit(a.startOffset + 2, 5, '')
    const edited = apply(doc0, del).doc
    expect(edited.highlights.map((h) => h.id)).toEqual([b.id])

    const undone = undoTxtDocument(edited)!
    expect(undone.textChanged).toBe(true)
    expect(undone.doc.text).toBe(SAMPLE_TEXT)
    expect(undone.doc.highlights).toEqual([a, b])
    expect(undone.selection).toEqual(sel(del.start))
    expect(canRedoTxt(undone.doc)).toBe(true)

    const redone = redoTxtDocument(undone.doc)!
    expect(redone.doc.text).toBe(edited.text)
    expect(redone.doc.highlights.map((h) => h.id)).toEqual([b.id])
    expect(redone.doc.highlights[0]).toEqual(edited.highlights[0])
  })

  it('a new edit after an undo clears the redo stack', () => {
    const doc = apply(createTxtDocument('abc'), edit(3, 0, 'd')).doc
    const undone = undoTxtDocument(doc)!.doc
    expect(canRedoTxt(undone)).toBe(true)
    expect(canRedoTxt(apply(undone, edit(0, 0, 'z'), 5000).doc)).toBe(false)
  })

  it('undo / redo with nothing to do returns null', () => {
    const doc = createTxtDocument('abc')
    expect(undoTxtDocument(doc)).toBeNull()
    expect(redoTxtDocument(doc)).toBeNull()
  })

  it('undoing a replacement puts the removed text back, annotations after it shift back', () => {
    const tail = highlightOf(SAMPLE_TEXT, 'needle')
    const doc0 = createTxtDocument(SAMPLE_TEXT, [tail])
    const edited = apply(doc0, edit(0, 8, 'X')).doc // "Chương 1" → "X"
    expect(edited.highlights[0]!.startOffset).toBe(tail.startOffset - 7)
    const undone = undoTxtDocument(edited)!.doc
    expect(undone.text).toBe(SAMPLE_TEXT)
    expect(undone.highlights).toEqual([tail])
  })

  it('undo then redo of random edit sequences restores the exact text and annotations at every step', () => {
    const next = rng(4242)
    for (let round = 0; round < 60; round++) {
      let doc = createTxtDocument(
        SAMPLE_TEXT,
        ['Khởi đầu', 'công viên', 'needle', 'hết'].map((needle) => highlightOf(SAMPLE_TEXT, needle)),
      )
      const snapshots: TxtDocument[] = [doc]
      const steps = randomInt(next, 1, 12)
      for (let s = 0; s < steps; s++) {
        const start = randomInt(next, 0, doc.text.length)
        const del = randomInt(next, 0, Math.min(8, doc.text.length - start))
        const ins = ['', 'a', 'xyz', '\n', 'é😀'][randomInt(next, 0, 4)]!
        if (del === 0 && ins === '') continue
        // 5 s apart → no coalescing, so every edit is its own undo step.
        doc = apply(doc, edit(start, del, ins), s * 5000).doc
        snapshots.push(doc)
      }
      for (let s = snapshots.length - 1; s > 0; s--) {
        doc = undoTxtDocument(doc)!.doc
        expect(doc.text).toBe(snapshots[s - 1]!.text)
        expect(doc.highlights).toEqual(snapshots[s - 1]!.highlights)
      }
      for (let s = 1; s < snapshots.length; s++) {
        doc = redoTxtDocument(doc)!.doc
        expect(doc.text).toBe(snapshots[s]!.text)
        expect(doc.highlights).toEqual(snapshots[s]!.highlights)
      }
    }
  })
})

describe('coalescing', () => {
  it('a run of typed characters is one undo step', () => {
    let doc = createTxtDocument('ab')
    for (const [i, ch] of [...'xyz'].entries()) doc = apply(doc, edit(1 + i, 0, ch), i * 100).doc
    expect(doc.text).toBe('axyzb')
    expect(doc.undoStack).toHaveLength(1)
    const undone = undoTxtDocument(doc)!.doc
    expect(undone.text).toBe('ab')
    expect(redoTxtDocument(undone)!.doc.text).toBe('axyzb')
  })

  it('a pause longer than the window starts a new step', () => {
    let doc = createTxtDocument('ab')
    doc = apply(doc, edit(1, 0, 'x'), 0).doc
    doc = apply(doc, edit(2, 0, 'y'), TXT_COALESCE_MS + 1).doc
    expect(doc.undoStack).toHaveLength(2)
  })

  it('a newline, a paste or a non-adjacent keystroke breaks the run', () => {
    let doc = createTxtDocument('ab')
    doc = apply(doc, edit(1, 0, 'x'), 0).doc
    doc = apply(doc, edit(2, 0, '\n'), 10).doc
    expect(doc.undoStack).toHaveLength(2)
    doc = apply(doc, edit(3, 0, 'pasted text'), 20).doc
    expect(doc.undoStack).toHaveLength(3)
    doc = apply(doc, edit(0, 0, 'q'), 30).doc
    expect(doc.undoStack).toHaveLength(4)
  })

  it('backspace and forward-delete runs are one step and undo restores every char', () => {
    let doc = createTxtDocument('abcdef')
    for (const [i, start] of [5, 4, 3].entries()) doc = apply(doc, edit(start, 1, ''), i * 50).doc
    expect(doc.text).toBe('abc')
    expect(doc.undoStack).toHaveLength(1)
    expect(undoTxtDocument(doc)!.doc.text).toBe('abcdef')

    let fwd = createTxtDocument('abcdef')
    for (let i = 0; i < 3; i++) fwd = apply(fwd, edit(1, 1, ''), i * 50).doc
    expect(fwd.text).toBe('aef')
    expect(fwd.undoStack).toHaveLength(1)
    expect(undoTxtDocument(fwd)!.doc.text).toBe('abcdef')
  })

  it('never merges across an edit that removed annotations (so they can all be restored)', () => {
    const h = makeHighlight('abcdef', 1, 3)
    let doc = createTxtDocument('abcdef', [h])
    doc = apply(doc, edit(2, 1, ''), 0).doc // inside the annotation → removed
    doc = apply(doc, edit(1, 1, ''), 10).doc
    expect(doc.undoStack).toHaveLength(2)
    let undone = undoTxtDocument(doc)!.doc
    undone = undoTxtDocument(undone)!.doc
    expect(undone.text).toBe('abcdef')
    expect(undone.highlights).toEqual([h])
  })
})

describe('annotation operations share the history', () => {
  it('add / update / remove are undone and redone in order', () => {
    const base = createTxtDocument(SAMPLE_TEXT)
    const h = highlightOf(SAMPLE_TEXT, 'needle')
    let doc = addTxtHighlight(base, h)
    doc = updateTxtHighlight(doc, h.id, { colorHex: '#ff0000', note: 'n' }, 'T1')
    expect(doc.highlights[0]).toMatchObject({ colorHex: '#ff0000', note: 'n', updatedAt: 'T1' })
    doc = removeTxtHighlight(doc, h.id)
    expect(doc.highlights).toEqual([])

    doc = undoTxtDocument(doc)!.doc
    expect(doc.highlights[0]).toMatchObject({ colorHex: '#ff0000', note: 'n' })
    doc = undoTxtDocument(doc)!.doc
    expect(doc.highlights[0]).toEqual(h)
    doc = undoTxtDocument(doc)!.doc
    expect(doc.highlights).toEqual([])
    expect(undoTxtDocument(doc)).toBeNull()

    doc = redoTxtDocument(doc)!.doc
    expect(doc.highlights).toEqual([h])
    expect(redoTxtDocument(doc)!.doc.highlights[0]).toMatchObject({ colorHex: '#ff0000' })
  })

  it('annotation steps never report a text change', () => {
    const h = highlightOf(SAMPLE_TEXT, 'needle')
    const doc = addTxtHighlight(createTxtDocument(SAMPLE_TEXT), h)
    const step = undoTxtDocument(doc)!
    expect(step.textChanged).toBe(false)
    expect(step.selection).toBeUndefined()
  })

  it('updating or removing an unknown id is a no-op', () => {
    const doc = createTxtDocument('abc')
    expect(removeTxtHighlight(doc, 'nope')).toBe(doc)
    expect(updateTxtHighlight(doc, 'nope', { colorHex: '#000' }, 'T')).toBe(doc)
  })

  it('an edit after undoing an annotation clears redo; interleaved text and annotation undo is chronological', () => {
    let doc = createTxtDocument('hello world')
    const h = makeHighlight('hello world', 6, 11)
    doc = apply(doc, edit(11, 0, '!'), 0).doc // "hello world!"
    doc = addTxtHighlight(doc, h)
    doc = apply(doc, edit(0, 0, '>> '), 9000).doc // shifts h by 3
    expect(doc.highlights[0]!.startOffset).toBe(9)

    doc = undoTxtDocument(doc)!.doc // undo the edit
    expect(doc.text).toBe('hello world!')
    expect(doc.highlights[0]!.startOffset).toBe(6)
    doc = undoTxtDocument(doc)!.doc // undo the annotation
    expect(doc.highlights).toEqual([])
    expect(doc.text).toBe('hello world!')
    doc = undoTxtDocument(doc)!.doc // undo the first edit
    expect(doc.text).toBe('hello world')
  })
})

describe('createTxtDocument / setTxtReadingOffset', () => {
  it('orders annotations by creation time and clamps the reading offset', () => {
    const late = makeHighlight('abcdef', 0, 2, { id: 'late', createdAt: '2026-10-18T10:00:00.000Z' })
    const early = makeHighlight('abcdef', 1, 3, { id: 'early', createdAt: '2026-10-18T09:00:00.000Z' })
    const doc = createTxtDocument('abcdef', [late, early], 99)
    expect(doc.highlights.map((h) => h.id)).toEqual(['early', 'late'])
    expect(doc.readingOffset).toBe(6)
  })

  it('setTxtReadingOffset clamps, truncates and keeps the same object when nothing changes', () => {
    const doc = createTxtDocument('abcdef', [], 2)
    expect(setTxtReadingOffset(doc, 2)).toBe(doc)
    expect(setTxtReadingOffset(doc, 99).readingOffset).toBe(6)
    expect(setTxtReadingOffset(doc, -4).readingOffset).toBe(0)
    expect(setTxtReadingOffset(doc, 3.7).readingOffset).toBe(3)
  })
})

describe('typing simulation through deriveTextEdit (what the text box reports)', () => {
  it('typing at the end of an annotation neither grows nor removes it; typing at its start moves it', () => {
    const text = 'say hello there'
    const h = highlightOf(text, 'hello')
    let doc = createTxtDocument(text, [h])

    const typeAt = (caret: number, ch: string) => {
      const after = doc.text.slice(0, caret) + ch + doc.text.slice(caret)
      const e = deriveTextEdit(doc.text, after, { selectionStart: caret, selectionEnd: caret, inputType: 'insertText' })!
      doc = apply(doc, e, 100_000 * (doc.undoStack.length + 1)).doc
    }

    typeAt(h.endOffset, 'o') // right after "hello"  → "hellooo"? no: after the annotation
    expect(doc.highlights).toHaveLength(1)
    expect(doc.highlights[0]).toMatchObject({ startOffset: h.startOffset, endOffset: h.endOffset })

    typeAt(h.startOffset, 'S') // right before it
    expect(doc.highlights[0]).toMatchObject({ startOffset: h.startOffset + 1, endOffset: h.endOffset + 1 })
    expect(doc.text.slice(doc.highlights[0]!.startOffset, doc.highlights[0]!.endOffset)).toBe('hello')

    typeAt(doc.highlights[0]!.startOffset + 2, 'l') // inside it
    expect(doc.highlights).toEqual([])
  })
})
