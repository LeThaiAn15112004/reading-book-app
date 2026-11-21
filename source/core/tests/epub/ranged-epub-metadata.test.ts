import { inflateRawSync } from 'node:zlib'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { readEpubImportMetadata } from '../../src/epub/epub-package'
import type { ArchiveReader } from '../../src/ports/archive'
import { openRangedZip } from '../../src/zip/ranged-zip'

/** The whole-buffer reader the import used before spec 016 (JSZip over every byte). */
async function jszipReader(bytes: Uint8Array): Promise<ArchiveReader> {
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir)
  return {
    listEntries: () => names,
    readText: async (p) => (zip.file(p) ? await zip.file(p)!.async('string') : null),
    readBytes: async (p) => (zip.file(p) ? await zip.file(p)!.async('uint8array') : null),
  }
}

function rangedReader(bytes: Uint8Array) {
  return openRangedZip(
    { size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) },
    (data) => new Uint8Array(inflateRawSync(data)),
  )
}

async function buildEpub(withCover: boolean): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:ranged</dc:identifier>
    <dc:title>Tiếng Việt — Sách mẫu</dc:title>
    <dc:creator>Nguyễn Văn A</dc:creator>
    <dc:description>Mô tả có dấu.</dc:description>
    <dc:subject>Văn học</dc:subject>
    <dc:language>vi</dc:language>
    ${withCover ? '<meta name="cover" content="cover-img"/>' : ''}
  </metadata>
  <manifest>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    ${withCover ? '<item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>' : ''}
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`,
  )
  zip.file('OEBPS/ch1.xhtml', '<html><body><p>' + 'Nội dung. '.repeat(5000) + '</p></body></html>')
  if (withCover) zip.file('OEBPS/images/cover.png', new Uint8Array(4096).map((_, i) => (i * 7) % 256), { compression: 'STORE' })
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

describe('readEpubImportMetadata on the ranged ZIP reader (FR-004, FR-007)', () => {
  for (const withCover of [true, false]) {
    it(`gives the same details and cover as the whole-buffer reader (${withCover ? 'with' : 'without'} cover)`, async () => {
      const bytes = await buildEpub(withCover)
      const before = await readEpubImportMetadata(await jszipReader(bytes), { includeCover: true })
      const after = await readEpubImportMetadata(await rangedReader(bytes), { includeCover: true })
      expect(after).toEqual(before)
      expect(after.title).toBe('Tiếng Việt — Sách mẫu')
      expect(Boolean(after.cover)).toBe(withCover)
    })
  }
})
