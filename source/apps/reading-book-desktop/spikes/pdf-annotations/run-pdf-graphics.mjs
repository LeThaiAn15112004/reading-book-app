/**
 * Graphic objects inside a PDF (docs/implementation_plan/pdf_graphic_objects.md): the REAL scan, edit
 * and verify code (`electron/pdf-sync/pdf-graphics.ts` + the incremental writer + pdf.js read-back) on a
 * generated PDF that holds Square / Circle / Ink / Line / FreeText annotations made "by another reader".
 *
 *   1. list      every object is found with its box, colour and the capabilities its type allows
 *   2. resize    Square / Circle / Ink: new /Rect, new appearance, original bytes untouched (one incremental update)
 *   3. colour    /C and the appearance change, geometry stays
 *   4. delete    removed from /Annots; the others stay; works for the types that offer nothing else
 *   5. refusals  colour / resize on a Line, unknown ids and ops the type does not allow never touch the file
 *
 * Run: npm run spike:pdf:graphics   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'

const { listPdfGraphicsBytes, editPdfGraphicBytes, PdfGraphicError } = await import('../../electron/pdf-sync/pdf-graphics.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/** One 600 × 800 pt page; objects 5–9 are the annotations (all indirect, in /Annots). */
function buildPdf() {
  const content = 'BT /F1 18 Tf 40 760 Td (graphics) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R /Annots [5 0 R 6 0 R 7 0 R 8 0 R 9 0 R] >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Annot /Subtype /Square /Rect [60 400 360 600] /C [0 0.5 1] /BS << /W 2 >> /F 4 /NM (sq) >>',
    '<< /Type /Annot /Subtype /Circle /Rect [400 400 560 600] /C [0 0 0] /IC [1 0 0] /BS << /W 1 >> /F 4 /NM (ci) >>',
    '<< /Type /Annot /Subtype /Ink /Rect [100 100 300 200] /InkList [[100 100 200 200 300 100]] /C [1 0 0] /BS << /W 3 >> /F 4 /NM (ink) >>',
    '<< /Type /Annot /Subtype /Line /Rect [10 650 120 750] /L [10 650 120 750] /C [0 0.6 0] /BS << /W 2 >> /F 4 /NM (ln) >>',
    '<< /Type /Annot /Subtype /FreeText /Rect [320 100 520 140] /DA (/Helv 12 Tf 1 0.5 0 rg) /Contents (hello world) /F 4 /NM (ft) >>',
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

const bytes = buildPdf()
const bySubtype = (objects, subtype) => objects.find((o) => o.subtype === subtype)
const startsWith = (output, original) => Buffer.from(output.subarray(0, original.length)).equals(Buffer.from(original))

console.log('1. list')
const listed = await listPdfGraphicsBytes(bytes)
await check('all five objects are found, box and colour mapped into the displayed page', () => {
  assert.equal(listed.complete, true)
  assert.deepEqual(listed.objects.map((o) => o.subtype).sort(), ['Circle', 'FreeText', 'Ink', 'Line', 'Square'])
  const sq = bySubtype(listed.objects, 'Square')
  assert.ok(Math.abs(sq.box.x - 0.1) < 1e-6 && Math.abs(sq.box.y - 0.25) < 1e-6)
  assert.ok(Math.abs(sq.box.width - 0.5) < 1e-6 && Math.abs(sq.box.height - 0.25) < 1e-6)
  assert.equal(sq.colorHex, '#0080FF')
  assert.equal(bySubtype(listed.objects, 'Circle').filled, true)
  assert.equal(bySubtype(listed.objects, 'Ink').paths[0].length, 3)
})
await check('capabilities follow the type: Square / Circle / Ink edit everything, Line / FreeText only delete', () => {
  for (const t of ['Square', 'Circle', 'Ink']) assert.deepEqual(bySubtype(listed.objects, t).caps, { resize: true, color: true, delete: true })
  for (const t of ['Line', 'FreeText']) assert.deepEqual(bySubtype(listed.objects, t).caps, { resize: false, color: false, delete: true })
})

console.log('2. resize')
await check('Square: a new box is written as one incremental update and read back', async () => {
  const sq = bySubtype(listed.objects, 'Square')
  const box = { x: 0.1, y: 0.25, width: 0.7, height: 0.4 }
  const result = await editPdfGraphicBytes(bytes, sq.objectId, { kind: 'resize', box })
  assert.ok(startsWith(result.output, bytes), 'original bytes untouched')
  assert.ok(result.output.length > bytes.length)
  const now = bySubtype(result.objects, 'Square')
  assert.ok(Math.abs(now.box.width - 0.7) < 1e-3 && Math.abs(now.box.height - 0.4) < 1e-3)
  assert.equal(now.colorHex, sq.colorHex)
  assert.equal(result.objects.length, 5)
  const again = await listPdfGraphicsBytes(result.output)
  assert.ok(Math.abs(bySubtype(again.objects, 'Square').box.width - 0.7) < 1e-3, 'a fresh scan agrees')
})
await check('Circle and Ink resize; the Ink points are scaled with the box', async () => {
  const circle = bySubtype(listed.objects, 'Circle')
  const c = await editPdfGraphicBytes(bytes, circle.objectId, { kind: 'resize', box: { x: 0.5, y: 0.2, width: 0.3, height: 0.3 } })
  assert.ok(Math.abs(bySubtype(c.objects, 'Circle').box.width - 0.3) < 1e-3)
  const ink = bySubtype(listed.objects, 'Ink')
  const i = await editPdfGraphicBytes(bytes, ink.objectId, { kind: 'resize', box: { x: 0.1, y: 0.8, width: 0.8, height: 0.1 } })
  const moved = bySubtype(i.objects, 'Ink')
  assert.ok(Math.abs(moved.box.width - 0.8) < 1e-3)
  const xs = moved.paths[0].map((p) => p[0])
  assert.ok(Math.abs(Math.min(...xs) - 0.1) < 1e-3 && Math.abs(Math.max(...xs) - 0.9) < 1e-3, 'points follow the new box')
})

console.log('3. colour')
await check('colour changes /C and the appearance but not the geometry', async () => {
  const sq = bySubtype(listed.objects, 'Square')
  const result = await editPdfGraphicBytes(bytes, sq.objectId, { kind: 'color', colorHex: '#FF0000' })
  const now = bySubtype(result.objects, 'Square')
  assert.equal(now.colorHex, '#FF0000')
  assert.ok(Math.abs(now.box.x - sq.box.x) < 1e-6 && Math.abs(now.box.width - sq.box.width) < 1e-6)
  const text = Buffer.from(result.output).toString('latin1')
  assert.match(text, /\/Subtype \/Form/)
  assert.match(text, /1 0 0 RG/)
})
await check('colour of an Ink keeps its points', async () => {
  const ink = bySubtype(listed.objects, 'Ink')
  const result = await editPdfGraphicBytes(bytes, ink.objectId, { kind: 'color', colorHex: '#00FF00' })
  const now = bySubtype(result.objects, 'Ink')
  assert.equal(now.colorHex, '#00FF00')
  assert.equal(now.paths[0].length, 3)
})

console.log('4. delete')
await check('delete removes only that object — also types that offer nothing else', async () => {
  for (const type of ['Line', 'FreeText', 'Square']) {
    const target = bySubtype(listed.objects, type)
    const result = await editPdfGraphicBytes(bytes, target.objectId, { kind: 'delete' })
    assert.ok(startsWith(result.output, bytes))
    assert.equal(result.objects.length, 4)
    assert.equal(result.objects.some((o) => o.subtype === type), false)
  }
})

console.log('5. refusals')
await check('an op the type does not allow, an unknown object: refused, nothing produced', async () => {
  const line = bySubtype(listed.objects, 'Line')
  await assert.rejects(() => editPdfGraphicBytes(bytes, line.objectId, { kind: 'color', colorHex: '#000000' }), (e) => e instanceof PdfGraphicError && e.code === 'not_allowed')
  await assert.rejects(() => editPdfGraphicBytes(bytes, line.objectId, { kind: 'resize', box: { x: 0, y: 0, width: 0.5, height: 0.5 } }), (e) => e instanceof PdfGraphicError && e.code === 'not_allowed')
  await assert.rejects(() => editPdfGraphicBytes(bytes, '999R', { kind: 'delete' }), (e) => e instanceof PdfGraphicError && e.code === 'not_found')
})
await check('an encrypted file is never written', async () => {
  const enc = new Uint8Array(Buffer.from(Buffer.from(bytes).toString('latin1').replace('/Root 1 0 R', '/Root 1 0 R /Encrypt 99 0 R'), 'latin1'))
  await assert.rejects(() => editPdfGraphicBytes(enc, '5R', { kind: 'delete' }))
})

console.log(`\n${passed} checks passed`)
process.exit(0)
