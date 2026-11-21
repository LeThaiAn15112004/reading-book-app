/**
 * Spec 016 (T021 / T042): shared by `capture-baseline-rows.mjs` and `run-import-parity.mjs`.
 *
 * - `buildSyntheticSamples(dir)` writes a small, deterministic sample set (EPUB with a cover image and full OPF
 *   metadata, EPUB without a cover, PDF, TXT, Markdown) so the parity check runs without the team's real books;
 *   `--samples <dir>` points both scripts at real files instead.
 * - `importSamples(files)` imports each file through the REAL `import:fromFile` handler (the native dialog is stubbed
 *   to return that file) on a fresh migrated database (node:sqlite, `db-stub.mjs`) and a temp userData.
 * - `rowOf(...)` projects a `books` row onto the fields FR-007 compares (no id / time / path), plus the cover's
 *   SHA-256 for a cover stored in the file. Generated covers (PDF / TXT / MD) are drawn by the renderer and are not
 *   compared here (FR-007 rule for drawn covers: hidden-window check, see tasks T021 / T042).
 *
 * Sample keys are `<format>-<sizeBytes>` (FR-001: never a file name).
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { buildZip, JPG } from '../audio/zip-fixtures.mjs'
import { app, dialog, handlers } from '../pdf-annotations/electron-stub.mjs'
import { getDatabase } from '../pdf-annotations/db-stub.mjs'

const sha = (b) => createHash('sha256').update(b).digest('hex')

function epub({ withCover }) {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:016-sample-${withCover ? 'a' : 'b'}</dc:identifier>
    <dc:title>Sample Book ${withCover ? 'With' : 'Without'} Cover</dc:title>
    <dc:creator>Ada Sample</dc:creator>
    <dc:creator>Ben Example</dc:creator>
    <dc:description>A deterministic sample used by spec 016 parity checks.</dc:description>
    <dc:subject>Testing</dc:subject>
    <dc:subject>Fiction</dc:subject>
    <dc:language>en</dc:language>
    ${withCover ? '<meta name="cover" content="cover-img"/>' : ''}
  </metadata>
  <manifest>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    ${withCover ? '<item id="cover-img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>' : ''}
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`
  const chapter = (n) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${n}</title></head><body><h1>Chapter ${n}</h1>${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>'.repeat(200)}</body></html>`
  return buildZip([
    { name: 'mimetype', data: Buffer.from('application/epub+zip') },
    {
      name: 'META-INF/container.xml',
      deflate: true,
      data: Buffer.from('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    },
    { name: 'OEBPS/content.opf', deflate: true, data: Buffer.from(opf) },
    { name: 'OEBPS/text/ch1.xhtml', deflate: true, data: Buffer.from(chapter(1)) },
    { name: 'OEBPS/text/ch2.xhtml', deflate: true, data: Buffer.from(chapter(2)) },
    ...(withCover ? [{ name: 'OEBPS/images/cover.jpg', data: JPG }] : []),
  ])
}

function pdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, // content stream, below
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Title (Sample PDF) /Author (Ada Sample) >>',
  ]
  const content = 'BT /F1 18 Tf 40 340 Td (Spec 016 sample page) Tj ET'
  let out = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out))
    out +=
      body === null
        ? `${i + 1} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`
        : `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/** Writes the synthetic sample set into `dir` and returns the file paths (one folder per file, exact names). */
export function buildSyntheticSamples(dir) {
  const files = [
    ['Sample With Cover.epub', epub({ withCover: true })],
    ['Sample Without Cover.epub', epub({ withCover: false })],
    ['Sample Paper.pdf', pdf()],
    ['Sample Notes.txt', Buffer.from('Spec 016 sample text.\n'.repeat(5000), 'utf8')],
    ['Sample Readme.md', Buffer.from('# Spec 016 sample\n\nSome *markdown* text.\n'.repeat(2000), 'utf8')],
  ]
  return files.map(([name, data], i) => {
    const folder = path.join(dir, String(i))
    fs.mkdirSync(folder, { recursive: true })
    const file = path.join(folder, name)
    fs.writeFileSync(file, data)
    return file
  })
}

/** Book files of a `--samples <dir>` folder (supported text formats only). */
export function listSampleFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(epub|pdf|txt|md)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f))
}

export const sampleKey = (file) => `${path.extname(file).slice(1).toLowerCase()}-${fs.statSync(file).size}`

/** Fields FR-007 compares. `signatureStatus` is the value once any background check has finished. */
export function rowOf(db, bookId) {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId)
  const authors = db
    .prepare('SELECT a.name AS name FROM book_authors ba JOIN authors a ON a.id = ba.author_id WHERE ba.book_id = ? ORDER BY ba.sort_order')
    .all(bookId)
    .map((r) => r.name)
  const parse = (json, fallback) => {
    try {
      return JSON.parse(json ?? '') ?? fallback
    } catch {
      return fallback
    }
  }
  const metadata = parse(book.metadata_json, {})
  // Every metadata field except timestamps (`…At`), so a new or missing field shows up as a difference.
  const stableMetadata = Object.fromEntries(
    Object.entries(metadata)
      .filter(([k]) => !/At$/.test(k))
      .sort(([a], [b]) => a.localeCompare(b)),
  )
  const coverPath = book.cover_path ?? null
  const coverSha256 = coverPath && fs.existsSync(coverPath) ? sha(fs.readFileSync(coverPath)) : null
  return {
    title: book.title,
    authors,
    format: book.file_format,
    genres: parse(book.genres_json, []),
    sha256: book.sha256,
    readingStatus: book.reading_status,
    metadata: stableMetadata,
    coverStoredInFile: coverSha256 !== null,
    coverSha256,
  }
}

const fakeSender = { isDestroyed: () => false, send: () => {} }

/**
 * Imports each file through the real `import:fromFile` handler; then imports the first one again (must be a
 * duplicate). Returns `{ rows: { [sampleKey]: row }, duplicateOk }`. `afterImport(bookId)` may run follow-up work
 * (e.g. a background signature check) before the row is read.
 */
export async function importSamples(files, { afterImport } = {}) {
  const userData = app.getPath('userData')
  fs.rmSync(path.dirname(userData), { recursive: true, force: true })
  fs.mkdirSync(userData, { recursive: true })
  const db = getDatabase()
  db.transaction ??= (fn) => (...args) => {
    db.exec('BEGIN')
    try {
      const r = fn(...args)
      db.exec('COMMIT')
      return r
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  const { ImportChannels } = await import('../../ipc/channels.ts')
  const { registerImportIpc } = await import('../../ipc/import.ipc.ts')
  registerImportIpc()
  const fromFile = handlers.get(ImportChannels.fromFile)
  const pick = async (file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    return fromFile({ sender: fakeSender })
  }

  const rows = {}
  for (const file of files) {
    const result = await pick(file)
    if (!result.ok || !result.bookId) throw new Error(`import failed for ${sampleKey(file)}: ${result.errorCode ?? '?'}`)
    if (afterImport) await afterImport(result.bookId)
    rows[sampleKey(file)] = rowOf(db, result.bookId)
  }
  const again = await pick(files[0])
  const duplicateOk = again.ok === false && again.errorCode === 'duplicate' && typeof again.bookId === 'string'
  return { rows, duplicateOk }
}
