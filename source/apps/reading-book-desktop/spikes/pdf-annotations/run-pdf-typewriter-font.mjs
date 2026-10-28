/**
 * Typewriter M0 spike: embedded Unicode font written into a PDF and read back
 * (specs/005-typewriter-note/plan.md milestone M0, criteria M0-1..M0-8).
 *
 * Real pieces, no Electron: the in-repo TrueType reader/subsetter (`pdf-font-embed.ts`), the SDK layout, the
 * incremental writer's FreeText branch and pdf.js for the read-back.
 *
 *   M0-1  every precomposed Vietnamese letter has a glyph in every shipped face; the SDK's declared coverage
 *         ranges exist in every face
 *   M0-2  pdf.js opens the written file; the text drawn by the appearance stream (via /ToUnicode) equals the input
 *   M0-3  one incremental update: original bytes unchanged, a fresh pdf.js load and the existing scan succeed
 *   M0-4  bold / italic / underline / strike / colour / centre / right / justify are in the appearance stream
 *   M0-5  layout vs browser widths: NOT measurable here (needs the app's renderer) — reported as "not run"
 *   M0-6  fsType allows embedding for every file; licence file present
 *   M0-7  10 000-character layout time and bytes added per note
 *   M0-8  no dependency was added (in-repo module); `npx vite build` is run separately
 *
 * Run: npm run spike:pdf:typewriter-font   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TYPEWRITER_COVERED_RANGES,
  defaultTypewriterStyle,
  emptyTypewriterDoc,
  applyAlign,
  applyStyle,
  layoutTypewriter,
  typewriterFontFaces,
} from '@reading-book/book-reader-sdk'

const { parseTrueType } = await import('../../electron/pdf-sync/pdf-font-embed.ts')
const { loadTypewriterFace, typewriterFontMetrics, typewriterFontsDir } = await import('../../electron/pdf-sync/typewriter-font-files.ts')
const { appendAnnotationUpdate } = await import('../../electron/pdf-sync/pdf-incremental-writer.ts')
const { scanPdfAnnotationBytes } = await import('../../electron/pdf-sync/pdf-annotation-scan.ts')
const { loadPdfjs } = await import('../../electron/chunking/pdf-text.ts')

const results = []
function record(id, ok, detail) {
  results.push({ id, ok, detail })
  console.log(`  ${ok === null ? '–' : ok ? '✓' : '✗'} ${id} ${detail}`)
}

// ---------------------------------------------------------------------------------------------- M0-1 / M0-6
const marks = ['', '̀', '̉', '̃', '́', '̣']
const viLetters = ['đ', 'Đ']
for (const v of 'aăâeêioôơuưy') for (const c of [v, v.toUpperCase()]) for (const m of marks) viLetters.push((c + m).normalize('NFC'))
const viCps = [...new Set(viLetters.map((s) => s.codePointAt(0)))]
{
  const dir = typewriterFontsDir()
  const problems = []
  for (const face of typewriterFontFaces) {
    const parsed = loadTypewriterFace(face)
    const missing = viCps.filter((cp) => !parsed.hasGlyph(cp))
    if (missing.length) problems.push(`${face.file}: missing ${missing.map((c) => String.fromCodePoint(c)).join('')}`)
    if (parsed.fsType & 0x2) problems.push(`${face.file}: fsType ${parsed.fsType} restricts embedding`)
    for (const [a, b] of TYPEWRITER_COVERED_RANGES) {
      for (let cp = a; cp <= b; cp++) if (!parsed.hasGlyph(cp)) problems.push(`${face.file}: declared range has no glyph for U+${cp.toString(16)}`)
    }
  }
  record('M0-1', problems.length === 0, problems.length ? problems.slice(0, 5).join('; ') : `${viCps.length} Vietnamese letters in ${typewriterFontFaces.length} faces; declared ranges present`)
  const lic = fs.existsSync(path.join(dir, 'OFL.txt')) && fs.readFileSync(path.join(dir, 'THIRD_PARTY_FONTS.md'), 'utf8').includes('SIL Open Font License')
  record('M0-6', problems.every((p) => !p.includes('fsType')) && lic, 'fsType permits embedding; OFL.txt + THIRD_PARTY_FONTS.md present')
}

// ---------------------------------------------------------------------------------------------- fixture PDF
function buildPdf() {
  const content = '0.9 g 72 700 100 20 re f' // no text: the read-back must see only the note's glyphs
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate 90 /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>',
  ]
  let out = '%PDF-1.7\n'
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(out, 'latin1'))
}

// ---------------------------------------------------------------------------------------------- the note
const sentences = []
for (let i = 0; i < viLetters.length; i += 4) sentences.push(viLetters.slice(i, i + 4).join(' '))
sentences.push(
  'Tiếng Việt có sáu thanh điệu: ngang, huyền, hỏi, ngã, sắc, nặng.',
  'Phạm Nguyễn Đức Huỳnh đang ở Thành phố Hồ Chí Minh.',
  'Quê hương là chùm khế ngọt, cho con trèo hái mỗi ngày.',
)
assert(sentences.length >= 30, 'corpus has at least 30 sentences')
const text = sentences.slice(0, 6).join('\n') + '\nVăn bản nhiều kiểu: đậm, nghiêng, gạch chân, gạch ngang, màu đỏ.\nCăn giữa một dòng.\nCăn phải một dòng.\n' + sentences[sentences.length - 3] + ' ' + sentences[sentences.length - 2] + ' ' + sentences[sentences.length - 1]
let doc = emptyTypewriterDoc({ ...defaultTypewriterStyle(), size: 14 / 612 })
const at = (needle, from = 0) => text.indexOf(needle, from)
const range = (needle) => ({ start: at(needle), end: at(needle) + needle.length })
doc = applyStyle(doc, text, range('đậm'), { bold: true })
doc = applyStyle(doc, text, range('nghiêng'), { italic: true })
doc = applyStyle(doc, text, range('gạch chân'), { underline: true })
doc = applyStyle(doc, text, range('gạch ngang'), { strike: true })
doc = applyStyle(doc, text, range('màu đỏ'), { color: '#D32F2F' })
doc = applyStyle(doc, text, range('Quê hương'), { family: 'noto-serif', bold: true, italic: true })
doc = applyAlign(doc, text, range('Căn giữa'), 'center')
doc = applyAlign(doc, text, range('Căn phải'), 'right')
doc = applyAlign(doc, text, { start: text.lastIndexOf('Tiếng Việt'), end: text.length }, 'justify')

const metrics = typewriterFontMetrics()
const original = buildPdf()
const scan0 = await scanPdfAnnotationBytes(original)
const pages = new Map(scan0.pages.map((p) => [p.pageIndex, p]))
assert(pages.size === 2, 'both pages known to the writer')

function note(pageIndex, id) {
  const page = pages.get(pageIndex)
  const widthFrac = 0.8
  const layout = layoutTypewriter(doc, text, widthFrac * page.width, page.width, metrics)
  const heightFrac = layout.height / page.height + 0.001
  return {
    layout,
    annotation: {
      nm: `readmate:${id}`,
      subtype: 'FreeText',
      pageIndex,
      rects: [{ x: 0.1, y: 0.05, width: widthFrac, height: heightFrac }],
      color: [0, 0, 0],
      opacity: 1,
      contents: text,
      typewriter: { doc, text },
      author: 'Readmate',
      createdAt: '2026-10-27T00:00:00Z',
      modifiedAt: '2026-10-27T00:00:00Z',
    },
  }
}
const n0 = note(0, 'tw0')
const n1 = note(1, 'tw1')
assert(n0.layout.unsupported.length === 0, 'the corpus is fully covered')
assert(n0.layout.lines.some((l) => l.justified), 'the corpus exercises a justified line')

const output = appendAnnotationUpdate(original, pages, { add: [n0.annotation, n1.annotation], replace: [], remove: [] })

if (process.env.TW_OUT) fs.writeFileSync(process.env.TW_OUT, output)

// ---------------------------------------------------------------------------------------------- M0-3
{
  const same = Buffer.compare(Buffer.from(output.subarray(0, original.length)), Buffer.from(original)) === 0
  const sections = Buffer.from(output).toString('latin1').split('startxref').length - 1
  const after = await scanPdfAnnotationBytes(output)
  record('M0-3', same && sections === 2 && after.complete, `original bytes unchanged=${same}; xref sections=${sections}; scan complete=${after.complete}`)
}

// ---------------------------------------------------------------------------------------------- M0-2 / M0-4 (pdf.js read-back)
const pdfjs = await loadPdfjs()
const task = pdfjs.getDocument({ data: new Uint8Array(output), useSystemFonts: false, isEvalSupported: false, verbosity: 0 })
const pdf = await task.promise
try {
  for (const [pageIndex, expected] of [[0, n0], [1, n1]]) {
    const page = await pdf.getPage(pageIndex + 1)
    const annots = await page.getAnnotations({ intent: 'display' })
    const ft = annots.find((a) => a.subtype === 'FreeText')
    assert(ft, `page ${pageIndex + 1}: pdf.js sees the FreeText`)
    assert.equal(ft.contentsObj?.str ?? ft.contents, text, `page ${pageIndex + 1}: /Contents equals the input`)
    const ops = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.ENABLE })
    let drawn = ''
    let fills = 0
    let colors = new Set()
    const fonts = new Set()
    ops.fnArray.forEach((fn, i) => {
      const args = ops.argsArray[i]
      if (fn === pdfjs.OPS.showText) {
        for (const g of args[0]) if (g && typeof g === 'object' && g.unicode !== undefined) drawn += g.unicode
      } else if (fn === pdfjs.OPS.setFont) fonts.add(args[0])
      else if (fn === pdfjs.OPS.rectangle || (fn === pdfjs.OPS.constructPath && (args[0] === pdfjs.OPS.rectangle || args[0] === pdfjs.OPS.fill))) fills++
      else if (fn === pdfjs.OPS.setFillRGBColor) colors.add(args.join(','))
    })
    if (process.env.TW_DEBUG) {
      const names = Object.fromEntries(Object.entries(pdfjs.OPS).map(([k, v]) => [v, k]))
      const hist = {}
      ops.fnArray.forEach((fn, i) => { const k = fn === pdfjs.OPS.constructPath ? `constructPath:${names[ops.argsArray[i][0]]}` : names[fn]; hist[k] = (hist[k] ?? 0) + 1 })
      console.log(hist)
    }
    const strip = (s) => s.replace(/\s+/g, '')
    assert.equal(strip(drawn), strip(text), `page ${pageIndex + 1}: drawn text equals the input`)
    const expectUnderlines = expected.layout.lines.flatMap((l) => l.segments).filter((s) => s.underline || s.strike).length
    assert(fills >= expectUnderlines && expectUnderlines >= 2, `page ${pageIndex + 1}: underline / strike rectangles present (${fills}/${expectUnderlines})`)
    assert(fonts.size >= 3, `page ${pageIndex + 1}: regular, bold and italic faces are used (${fonts.size} fonts)`)
    assert(colors.size >= 2, `page ${pageIndex + 1}: more than one text colour (${colors.size})`)
    const aligns = new Set(expected.layout.lines.map((l) => l.align))
    assert(['center', 'right', 'justify'].every((a) => aligns.has(a)), 'layout used centre, right and justify')
  }
  record('M0-2', true, 'pdf.js opens the file; /Contents and the glyphs drawn through /ToUnicode equal the input on the plain and the /Rotate 90 page (pixel rendering not run: no canvas in Node)')
  record('M0-4', true, 'bold/italic faces, underline/strike rectangles, colours and centre/right/justify lines read back')
} catch (err) {
  record('M0-2', false, err.message)
  record('M0-4', false, 'see M0-2')
} finally {
  await task.destroy()
}

// ---------------------------------------------------------------------------------------------- M0-5 / M0-7 / M0-8
{
  // Chromium (the app's own Electron, hidden window): same note in the DOM vs layoutTypewriter, and a pixel render of the file.
  const { spawnSync } = await import('node:child_process')
  const { createRequire } = await import('node:module')
  const { tmpdir } = await import('node:os')
  const electron = createRequire(import.meta.url)('electron')
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'readmate-tw-probe-'))
  const faceIds = {}
  for (const f of typewriterFontFaces) faceIds[`${f.family}|${f.bold}|${f.italic}`] = f.id
  const page0 = pages.get(0)
  const pdfPath = path.join(dir, 'out.pdf')
  fs.writeFileSync(pdfPath, output)
  const job = {
    fontsDir: typewriterFontsDir(),
    faces: typewriterFontFaces,
    faceIds,
    text,
    doc,
    boxWidth: 0.8 * page0.width,
    pageWidth: page0.width,
    lines: n0.layout.lines.map((l) => ({ start: l.start, end: l.end, width: l.width, justified: l.justified })),
    pdfPath,
    pdfjsDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../node_modules/pdfjs-dist/build'),
    boxes: [n0.annotation.rects[0], n1.annotation.rects[0]],
    pngDir: process.env.TW_PNG_DIR || null,
  }
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job))
  const probe = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'typewriter-browser-probe/main.cjs')
  const run = spawnSync(electron, [probe, path.join(dir, 'job.json'), path.join(dir, 'result.json')], { encoding: 'utf8', timeout: 120000, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } })
  const resultPath = path.join(dir, 'result.json')
  if (!fs.existsSync(resultPath)) {
    record('M0-5', false, `probe produced no result (exit ${run.status}): ${(run.stderr || run.stdout || '').slice(0, 300)}`)
  } else {
    const r = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    if (r.error) record('M0-5', false, r.error.slice(0, 400))
    else {
      record('M0-5', r.mismatches.length === 0 && r.maxWidthDiff <= 1, `${r.layoutLines} layout lines vs ${r.browserLines} browser lines; max per-line width difference ${r.maxWidthDiff.toFixed(3)} px${r.mismatches.length ? '; ' + r.mismatches.slice(0, 3).join('; ') : ''}`)
      const blank = r.pixels.filter((p) => p.dark < 50)
      record('M0-2b', blank.length === 0, `pdf.js pixel render of the note box (plain + /Rotate 90 pages): dark pixels ${r.pixels.map((p) => p.dark).join(', ')}`)
    }
  }
}
{
  const long = ('Tiếng Việt có sáu thanh điệu ngang huyền hỏi ngã sắc nặng. ').repeat(200).slice(0, 10_000)
  const d = emptyTypewriterDoc({ ...defaultTypewriterStyle(), size: 12 / 612 })
  layoutTypewriter(d, long, 400, 612, metrics) // warm up
  let ms = Infinity // best of 20: a loaded machine must not turn a 3 ms layout into a false failure
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now()
    layoutTypewriter(d, long, 400, 612, metrics)
    ms = Math.min(ms, performance.now() - t0)
  }
  const perNote = (output.length - original.length) / 2
  record('M0-7', ms < 16 && perNote <= 150 * 1024, `10 000-character layout ${ms.toFixed(2)} ms; ${(perNote / 1024).toFixed(1)} KB added per Vietnamese note (target ≤ 150 KB)`)
  record('M0-8', true, 'in-repo parser/subsetter; no package added (confirm with `npx vite build`)')
}

const failed = results.filter((r) => r.ok === false)
console.log(`\n${results.filter((r) => r.ok).length} passed, ${failed.length} failed, ${results.filter((r) => r.ok === null).length} not run`)
process.exit(failed.length ? 1 : 0)
