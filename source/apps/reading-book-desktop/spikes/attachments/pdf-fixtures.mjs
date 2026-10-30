/**
 * Minimal PDF writer for the attachment checks: a catalog, N blank pages, document-level embedded
 * files (the `/Names /EmbeddedFiles` tree) and page-level `FileAttachment` annotations, with a real
 * cross-reference table so PDF.js opens it without repair.
 */

function literal(text) {
  // Beyond Latin-1 (e.g. bidi controls): a UTF-16BE hex string with BOM, as PDF text strings allow.
  if (/[^\u0000-ÿ]/.test(String(text))) {
    const units = String(text).split('').map((ch) => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('')
    return `<FEFF${units}>`
  }
  return `(${String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`
}

/**
 * @param {{
 *   pages?: number,
 *   docFiles?: Array<{ key?: string, name?: string | null, desc?: string, data?: Uint8Array, noStream?: boolean }>,
 *   pageFiles?: Array<{ page: number, name?: string | null, desc?: string, data?: Uint8Array, nm?: string, rect?: number[], declaredSize?: number }>,
 * }} options
 */
export function buildPdf({ pages = 1, docFiles = [], pageFiles = [] } = {}) {
  /** @type {(Buffer | null)[]} index = object number */
  const objects = [null]
  const reserve = () => objects.push(null) - 1
  const catalog = reserve()
  const pagesObj = reserve()
  const pageObjs = Array.from({ length: pages }, reserve)
  const add = (body) => {
    const n = reserve()
    objects[n] = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1')
    return n
  }

  function addFileSpec({ name, desc, data, noStream, declaredSize }) {
    let ef = ''
    if (!noStream) {
      const payload = Buffer.from(data ?? new Uint8Array(0))
      const stream = add(
        Buffer.concat([
          Buffer.from(
            `<< /Type /EmbeddedFile /Length ${payload.length}${declaredSize === undefined ? '' : ` /Params << /Size ${declaredSize} >>`} >>\nstream\n`,
            'latin1',
          ),
          payload,
          Buffer.from('\nendstream', 'latin1'),
        ]),
      )
      ef = ` /EF << /F ${stream} 0 R >>`
    }
    const names = name === null || name === undefined ? '' : ` /F ${literal(name)} /UF ${literal(name)}`
    const description = desc ? ` /Desc ${literal(desc)}` : ''
    return add(`<< /Type /Filespec${names}${description}${ef} >>`)
  }

  const nameTree = docFiles
    .map((file, index) => ({ key: file.key ?? `k${String(index).padStart(3, '0')}`, spec: addFileSpec(file) }))
    .sort((a, b) => (a.key < b.key ? -1 : 1))
  const annotsByPage = new Map()
  for (const file of pageFiles) {
    const spec = addFileSpec(file)
    const annot = add(
      `<< /Type /Annot /Subtype /FileAttachment /Rect [${(file.rect ?? [10, 10, 30, 30]).join(' ')}] /Name /PushPin /Contents (attached) /FS ${spec} 0 R /F 4${file.nm ? ` /NM ${literal(file.nm)}` : ''} >>`,
    )
    annotsByPage.set(file.page, [...(annotsByPage.get(file.page) ?? []), annot])
  }

  pageObjs.forEach((n, index) => {
    const annots = annotsByPage.get(index + 1)
    const annotsEntry = annots ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]` : ''
    objects[n] = Buffer.from(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 200 200]${annotsEntry} >>`,
      'latin1',
    )
  })
  objects[pagesObj] = Buffer.from(
    `<< /Type /Pages /Kids [${pageObjs.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages} >>`,
    'latin1',
  )
  const names = nameTree.length
    ? ` /Names << /EmbeddedFiles << /Names [${nameTree.map(({ key, spec }) => `${literal(key)} ${spec} 0 R`).join(' ')}] >> >>`
    : ''
  objects[catalog] = Buffer.from(`<< /Type /Catalog /Pages ${pagesObj} 0 R${names} >>`, 'latin1')

  const chunks = [Buffer.from('%PDF-1.7\n', 'latin1')]
  const offsets = [0]
  let position = chunks[0].length
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = position
    const chunk = Buffer.concat([Buffer.from(`${n} 0 obj\n`, 'latin1'), objects[n], Buffer.from('\nendobj\n', 'latin1')])
    chunks.push(chunk)
    position += chunk.length
  }
  const xref = [`xref\n0 ${objects.length}\n`, '0000000000 65535 f \n']
  for (let n = 1; n < objects.length; n++) xref.push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  xref.push(`trailer\n<< /Size ${objects.length} /Root ${catalog} 0 R >>\nstartxref\n${position}\n%%EOF\n`)
  chunks.push(Buffer.from(xref.join(''), 'latin1'))
  return new Uint8Array(Buffer.concat(chunks))
}
