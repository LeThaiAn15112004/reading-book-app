/**
 * T5.3 checks for the tolerant CFI → DOM resolver used by DomCssOverlay.
 *
 * Verse markup is the regression under test: `<br>` splits a paragraph into
 * several text nodes, epubjs stores the selection end offset against the first
 * chunk only, and its own `Contents.range()` then throws instead of recovering.
 *
 * Run: node --experimental-strip-types spikes/highlight-overlay/run-cfi-range.mjs
 */

import assert from 'node:assert/strict'
import {
  cfiChapterSignature,
  elementFromCfi,
  findRangeByText,
  isTrivialSectionStartCfi,
  parseCfi,
  rangeBetweenBoundaries,
  rangeMatchesText,
  resolveCfiBoundary,
  resolveCfiRange,
  splitCfiComponents,
} from '../../src/reader/renderers/epub/cfi-dom-range.ts'
import { toEpubjsDisplayCfi } from '../../src/reader/renderers/epub/selection-cfi.ts'

// --- Minimal DOM + Range, enough for the resolver's node walking -------------

class NodeBase {
  constructor() {
    this.childNodes = []
    this.parentNode = null
  }

  get firstChild() {
    return this.childNodes[0] ?? null
  }

  get nextSibling() {
    const siblings = this.parentNode?.childNodes
    if (!siblings) return null
    return siblings[siblings.indexOf(this) + 1] ?? null
  }

  get parentElement() {
    return this.parentNode?.nodeType === 1 ? this.parentNode : null
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this
      this.childNodes.push(node)
    }
    return this
  }
}

class FakeText extends NodeBase {
  constructor(data) {
    super()
    this.nodeType = 3
    this.data = data
  }

  get length() {
    return this.data.length
  }
}

class FakeElement extends NodeBase {
  constructor(tagName, attributes = {}) {
    super()
    this.nodeType = 1
    this.tagName = tagName.toUpperCase()
    this.attributes = attributes
  }

  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1)
  }

  getAttribute(name) {
    return this.attributes[name] ?? null
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
  }
}

const text = (data) => new FakeText(data)
const el = (tagName, attributes, ...children) =>
  new FakeElement(tagName, attributes).append(...children)

/** Absolute character index of a boundary, for ordering and slicing. */
function absoluteOffset(doc, node, offset) {
  let total = 0
  for (const candidate of doc.textNodes()) {
    if (candidate === node) return total + offset
    total += candidate.length
  }
  // Element boundary: fall back to the start of its subtree.
  const first = doc.textNodes().find((t) => doc.isWithin(t, node))
  return first ? absoluteOffset(doc, first, 0) : total
}

class FakeRange {
  constructor(doc) {
    this.doc = doc
    this.startContainer = null
    this.startOffset = 0
    this.endContainer = null
    this.endOffset = 0
  }

  #validate(node, offset) {
    const limit = node.nodeType === 3 ? node.length : node.childNodes.length
    if (offset < 0 || offset > limit) {
      throw new Error(`IndexSizeError: offset ${offset} exceeds ${limit}`)
    }
  }

  setStart(node, offset) {
    this.#validate(node, offset)
    this.startContainer = node
    this.startOffset = offset
    if (!this.endContainer || this.#endBeforeStart()) {
      this.endContainer = node
      this.endOffset = offset
    }
  }

  setEnd(node, offset) {
    this.#validate(node, offset)
    this.endContainer = node
    this.endOffset = offset
    if (this.startContainer && this.#endBeforeStart()) {
      this.startContainer = node
      this.startOffset = offset
    }
  }

  #endBeforeStart() {
    return (
      absoluteOffset(this.doc, this.endContainer, this.endOffset) <
      absoluteOffset(this.doc, this.startContainer, this.startOffset)
    )
  }

  get collapsed() {
    return (
      this.startContainer === this.endContainer &&
      this.startOffset === this.endOffset
    )
  }

  toString() {
    const from = absoluteOffset(this.doc, this.startContainer, this.startOffset)
    const to = absoluteOffset(this.doc, this.endContainer, this.endOffset)
    return this.doc.flatText().slice(from, to)
  }
}

class FakeDocument {
  constructor(documentElement) {
    this.nodeType = 9
    this.documentElement = documentElement
    documentElement.parentNode = this
  }

  get body() {
    return this.documentElement.children.find((node) => node.tagName === 'BODY')
  }

  createRange() {
    return new FakeRange(this)
  }

  getElementById(id) {
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue
        if (child.getAttribute('id') === id) return child
        const found = walk(child)
        if (found) return found
      }
      return null
    }
    return walk(this.documentElement)
  }

  textNodes() {
    const out = []
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) out.push(child)
        else if (child.nodeType === 1) walk(child)
      }
    }
    walk(this.documentElement)
    return out
  }

  flatText() {
    return this.textNodes()
      .map((node) => node.data)
      .join('')
  }

  isWithin(node, ancestor) {
    for (let current = node; current; current = current.parentNode) {
      if (current === ancestor) return true
    }
    return false
  }
}

// --- Fixture: the verse block that failed to paint ---------------------------

const VERSE_LINE_ONE = '"Like streams of water in the South'
const VERSE_LINE_TWO = 'Our bondage, Lord, recall."'
const PROSE = 'THIS is all a tale of an older world.'

function buildDocument() {
  const verse = el(
    'p',
    {},
    text(VERSE_LINE_ONE),
    el('br', {}),
    text(VERSE_LINE_TWO),
  )
  const chapter = el(
    'div',
    { id: 'id70270891531960' },
    el('h1', {}, text('Streams of Water')),
    verse,
  )
  const body = el(
    'body',
    {},
    el('div', { id: 'header' }, el('p', {}, text(PROSE))),
    chapter,
  )
  const html = el('html', {}, el('head', {}, el('title', {}, text('Book'))), body)
  return { doc: new FakeDocument(html), verse }
}

// --- Checks -----------------------------------------------------------------

// The CFI shape epubjs emitted for the failing verse selection: both ends point
// at the first text node, and the end offset (128) overflows it.
const VERSE_CFI = 'epubcfi(/6/60!/4/4[id70270891531960]/4,/1:0,/1:128)'
const VERSE_START_CFI = 'epubcfi(/6/60!/4/4[id70270891531960]/4,/1:0)'
const VERSE_END_CFI = 'epubcfi(/6/60!/4/4[id70270891531960]/4,/1:128)'
const VERSE_TEXT = `${VERSE_LINE_ONE}\n${VERSE_LINE_TWO}`

assert.deepEqual(splitCfiComponents(VERSE_CFI), [
  '/6/60!/4/4[id70270891531960]/4',
  '/1:0',
  '/1:128',
])
assert.equal(splitCfiComponents('not a cfi').length, 0)

// epubjs drops the tail of a two-component CFI; this parser keeps the offset.
const point = parseCfi(VERSE_END_CFI)
assert.ok(point, 'point CFI must parse')
assert.equal(point.offset ?? point.path.offset, 128)
assert.equal(point.path.steps.length, 4)

{
  const { doc, verse } = buildDocument()
  const range = resolveCfiRange(doc, VERSE_CFI)
  assert.ok(range, 'overflowing end offset must still resolve')
  assert.ok(!range.collapsed, 'resolved verse range must not be collapsed')
  assert.ok(
    rangeMatchesText(range, VERSE_TEXT),
    `verse range text mismatch: ${JSON.stringify(range.toString())}`,
  )
  assert.equal(elementFromCfi(doc, VERSE_START_CFI), verse)
}

{
  // Same failure resolved from the two point CFIs the overlay also stores.
  const { doc } = buildDocument()
  const start = resolveCfiBoundary(doc, VERSE_START_CFI, {}, false)
  const end = resolveCfiBoundary(doc, VERSE_END_CFI, {}, true)
  assert.ok(start && end, 'point CFIs must resolve to boundaries')
  const range = rangeBetweenBoundaries(doc, start, end)
  assert.ok(range && !range.collapsed, 'point CFI pair must span the verse')
  assert.ok(rangeMatchesText(range, VERSE_TEXT), 'point CFI pair text mismatch')
}

{
  // Reversed selection direction must still produce a forward range.
  const { doc } = buildDocument()
  const start = resolveCfiBoundary(doc, VERSE_END_CFI, {}, true)
  const end = resolveCfiBoundary(doc, VERSE_START_CFI, {}, false)
  const range = rangeBetweenBoundaries(doc, start, end)
  assert.ok(range && !range.collapsed, 'reversed boundaries must still span')
}

{
  // Prose keeps working through the plain in-bounds path.
  const { doc } = buildDocument()
  const range = resolveCfiRange(doc, 'epubcfi(/6/60!/4/2[header]/2,/1:0,/1:4)')
  assert.ok(range, 'prose CFI must resolve')
  assert.equal(range.toString(), 'THIS')
}

{
  // Text re-anchoring ignores whitespace so `<br>` line breaks match.
  const { doc, verse } = buildDocument()
  const range = findRangeByText(doc, verse, VERSE_TEXT)
  assert.ok(range, 'verse must be found by text')
  assert.ok(rangeMatchesText(range, VERSE_TEXT), 're-anchored text mismatch')
  assert.equal(findRangeByText(doc, verse, 'text that is absent'), null)
}

{
  // A broken element path still re-anchors through the document scope.
  const { doc } = buildDocument()
  const range = findRangeByText(doc, elementFromCfi(doc, 'epubcfi(/6/60!/4/8/8)'), VERSE_TEXT)
  assert.ok(range, 'stale CFI must still re-anchor by text')
}

assert.equal(cfiChapterSignature(VERSE_CFI), '/6/60')
assert.equal(cfiChapterSignature('epubcfi(/6/60[chap05]!/4/2,/1:0,/1:5)'), '/6/60')
assert.equal(cfiChapterSignature('/6/60'), '/6/60')
assert.notEqual(cfiChapterSignature('epubcfi(/6/62!/4/2,/1:0,/1:5)'), '/6/60')

assert.equal(
  toEpubjsDisplayCfi('epubcfi(/6/60!/4/2,/1:0,/1:9)'),
  'epubcfi(/6/60!/4/2,/1:0)',
)
assert.equal(
  toEpubjsDisplayCfi('epubcfi(/6/60!/4/2,/1:0)'),
  'epubcfi(/6/60!/4/2,/1:0)',
)
assert.equal(toEpubjsDisplayCfi(''), null)
assert.equal(toEpubjsDisplayCfi('not-a-cfi'), null)
assert.equal(isTrivialSectionStartCfi('epubcfi(/6/2!/4/1:0)'), true)
assert.equal(isTrivialSectionStartCfi('epubcfi(/6/60!/4/2/2,/1:0)'), false)

console.log('ok tolerant CFI → DOM range resolution')
