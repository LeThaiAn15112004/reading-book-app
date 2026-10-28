/**
 * Typewriter performance (specs/005-typewriter-note, T067): re-layout time of a note at the 10 000-character cap
 * with 500 style runs (what every keystroke in the editor costs besides the DOM), the same for the writer
 * (layout + font subsetting + appearance stream), measured with the real SDK layout and the shipped fonts.
 * Targets: layout ≤ 16 ms per keystroke (one frame), writing a worst-case note ≤ 1 s.
 *
 * Run: npm run spike:pdf:typewriter-perf
 */
import assert from 'node:assert/strict'
import { applyStyle, editText, emptyTypewriterDoc, layoutTypewriter, TYPEWRITER_MAX_CHARS } from '@reading-book/book-reader-sdk'
import { buildAnnotatedPdf } from '../../e2e/support/build-annotated-pdf.mjs'

const { typewriterFontMetrics } = await import('../../electron/pdf-sync/typewriter-font-files.ts')
const { writeAnnotationsToPdf } = await import('../../electron/pdf-sync/pdf-annotation-write.ts')
const metrics = typewriterFontMetrics()

const WORDS = 'xin chào thế giới đây là một ghi chú rất dài để đo hiệu năng bố cục chữ '
let text = ''
while (text.length < TYPEWRITER_MAX_CHARS) text += WORDS
text = text.slice(0, TYPEWRITER_MAX_CHARS)
let doc = emptyTypewriterDoc()
for (let i = 0; i < 500; i++) doc = applyStyle(doc, text, { start: i * 18, end: i * 18 + 5 }, i % 2 ? { bold: true } : { italic: true, color: '#E53935' })
const boxWidth = 0.6

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
function time(n, fn) {
  const samples = []
  for (let i = 0; i < n; i++) {
    const t = performance.now()
    fn()
    samples.push(performance.now() - t)
  }
  return { median: median(samples), max: Math.max(...samples) }
}

layoutTypewriter(doc, text, boxWidth, 1, metrics) // warm up
const layout = time(30, () => layoutTypewriter(doc, text, boxWidth, 1, metrics))
const keystroke = time(30, () => {
  const r = editText(doc, text, { start: 5000, end: 5000, insert: 'a' })
  layoutTypewriter(r.doc, r.text, boxWidth, 1, metrics)
})
console.log(`  layout of ${text.length} chars / ${doc.runs.length} runs: median ${layout.median.toFixed(1)} ms, max ${layout.max.toFixed(1)} ms`)
console.log(`  one keystroke (edit + re-layout): median ${keystroke.median.toFixed(1)} ms, max ${keystroke.max.toFixed(1)} ms`)

// A page-sized note: the smallest size (6 pt) so the worst-case text fits the page and is really written.
const small = applyStyle(doc, text, null, { size: 6 / 612 })
const rows = [{
  id: 'big', styleKind: 'typewriter', colorHex: doc.base.color, note: text, tags: [],
  pdfAnnotation: { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.05, y: 0.02, width: 0.9, height: 0.95 }], typewriter: small },
  createdAt: '2026-10-28T08:00:00.000Z', updatedAt: '2026-10-28T09:00:00.000Z',
}]
const source = buildAnnotatedPdf({})
const t0 = performance.now()
const out = await writeAnnotationsToPdf({ bytes: source, ledger: [], rows })
const write = performance.now() - t0
console.log(`  writing the worst-case note into a PDF (layout + subset fonts + read-back): ${write.toFixed(0)} ms, skipped: ${JSON.stringify(out.skipped)}`)

assert.ok(keystroke.median <= 16, `a keystroke costs ${keystroke.median.toFixed(1)} ms (target ≤ 16)`)
assert.equal(out.skipped.length, 0, 'the worst-case note was really written')
assert.ok(write <= 1000, `writing took ${write.toFixed(0)} ms (target ≤ 1000)`)
console.log('\nperformance targets met')
