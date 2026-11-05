// M2 only (T020): writes the fixed sample books. `large` adds 100 MB files, padded to measure loading a file
// of that size: they do not stand for a real 100 MB book's page or image load.
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const MB = 1024 * 1024

function makePdf(pageCount, paddingBytes) {
  const parts = []
  const offsets = []
  let size = 0
  const push = (chunk) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'latin1')
    parts.push(buffer)
    size += buffer.length
  }
  const object = (id, body) => {
    offsets[id] = size
    push(`${id} 0 obj\n${body}\nendobj\n`)
  }

  push('%PDF-1.7\n')
  const pageIds = Array.from({ length: pageCount }, (_, i) => 4 + i * 2)
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Count ${pageCount} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`)
  object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  pageIds.forEach((id, index) => {
    const lines = Array.from({ length: 30 }, (_, line) => `(Page ${index + 1}, line ${line + 1}: select this text to test the toolbar.) Tj T*`)
    const stream = `BT /F1 11 Tf 50 780 Td 16 TL\n${lines.join('\n')}\nET`
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`)
    object(id + 1, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })
  let lastId = 3 + pageCount * 2
  if (paddingBytes > 0) {
    lastId += 1
    offsets[lastId] = size
    push(`${lastId} 0 obj\n<< /Length ${paddingBytes} >>\nstream\n`)
    push(randomBytes(paddingBytes))
    push('\nendstream\nendobj\n')
  }
  const xref = size
  const rows = offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
  push(`xref\n0 ${lastId + 1}\n0000000000 65535 f \n${rows.join('')}`)
  push(`trailer\n<< /Size ${lastId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return Buffer.concat(parts)
}

async function makeLargeEpub(smallEpub, paddingBytes) {
  const zip = await JSZip.loadAsync(smallEpub)
  zip.file('OEBPS/padding.bin', randomBytes(paddingBytes), { compression: 'STORE' })
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
}

export async function writeFeasibilitySamples(outDir, sampleEpubPath, { large }) {
  mkdirSync(outDir, { recursive: true })
  const smallEpub = readFileSync(sampleEpubPath)
  const sentence = 'The quick brown fox reads a long book on a small phone. '
  const books = [
    { id: 'feas-epub', title: 'Sample EPUB', format: 'epub', file: 'sample.epub', data: smallEpub },
    { id: 'feas-pdf', title: 'Sample PDF', format: 'pdf', file: 'sample.pdf', data: makePdf(30, 0) },
    { id: 'feas-txt', title: 'Sample TXT', format: 'txt', file: 'sample.txt', data: Buffer.from(`${sentence.repeat(12)}\n\n`.repeat(200)) },
    {
      id: 'feas-md',
      title: 'Sample Markdown',
      format: 'md',
      file: 'sample.md',
      data: Buffer.from(`# Sample\n\n${`## Section\n\n${sentence.repeat(10)}\n\n- one\n- two\n\n`.repeat(40)}`),
    },
  ]
  if (large) {
    books.push(
      { id: 'feas-epub-100', title: 'EPUB 100 MB', format: 'epub', file: 'large.epub', data: await makeLargeEpub(smallEpub, 100 * MB) },
      { id: 'feas-pdf-100', title: 'PDF 100 MB', format: 'pdf', file: 'large.pdf', data: makePdf(30, 100 * MB) },
    )
  }
  for (const book of books) writeFileSync(path.join(outDir, book.file), book.data)
  const manifest = books.map(({ data, ...book }) => ({ ...book, bytes: data.length }))
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}
