/**
 * Build a minimal multi-chapter EPUB fixture for T3.1 engine spike.
 * Output: spikes/epub-engine/fixtures/spike-sample.epub
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outPath = path.join(__dirname, 'fixtures', 'spike-sample.epub')
/** Served by Vite from /public for the Electron harness at #/spike/epub */
const publicOutPath = path.join(
  __dirname,
  '../../public/spikes/spike-sample.epub',
)

const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:spike-t31-sample-001</dc:identifier>
    <dc:title>Spike Sample Book</dc:title>
    <dc:creator>T3.1 Spike</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-07-27T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`

const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:spike-t31-sample-001"/>
  </head>
  <docTitle><text>Spike Sample Book</text></docTitle>
  <navMap>
    <navPoint id="np1" playOrder="1">
      <navLabel><text>Chapter One</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
    <navPoint id="np2" playOrder="2">
      <navLabel><text>Chapter Two</text></navLabel>
      <content src="chapter2.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`

const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>Contents</title><link rel="stylesheet" href="style.css"/></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      <li><a href="chapter1.xhtml">Chapter One</a></li>
      <li><a href="chapter2.xhtml#sec-search">Chapter Two</a></li>
    </ol>
  </nav>
</body>
</html>`

const chapter1 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head><title>Chapter One</title><link rel="stylesheet" href="style.css"/></head>
<body>
  <h1 id="ch1">Chapter One</h1>
  <p>This is the first chapter of the T3.1 spike sample book. It has enough text to paginate or scroll.</p>
  <p>Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi.</p>
  <p>Reflowable EPUB content should accept runtime CSS for font size and theme without mutating the archive.</p>
</body>
</html>`

const chapter2 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head><title>Chapter Two</title><link rel="stylesheet" href="style.css"/></head>
<body>
  <h1 id="ch2">Chapter Two</h1>
  <p id="sec-search">Searchable phrase: neon lantern under the quiet shelf.</p>
  <p>Second chapter continues the sample for next/prev navigation and TOC jump checks.</p>
  <p>Selection of this paragraph should remain possible inside the reading surface.</p>
</body>
</html>`

const styleCss = `body { font-family: Georgia, serif; line-height: 1.6; margin: 1.5em; }
h1 { font-size: 1.4em; }`

const zip = new JSZip()
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
zip.folder('META-INF').file('container.xml', containerXml)
const oebps = zip.folder('OEBPS')
oebps.file('content.opf', contentOpf)
oebps.file('nav.xhtml', navXhtml)
oebps.file('toc.ncx', tocNcx)
oebps.file('chapter1.xhtml', chapter1)
oebps.file('chapter2.xhtml', chapter2)
oebps.file('style.css', styleCss)

await fs.mkdir(path.dirname(outPath), { recursive: true })
await fs.mkdir(path.dirname(publicOutPath), { recursive: true })
const buf = await zip.generateAsync({
  type: 'nodebuffer',
  mimeType: 'application/epub+zip',
  compression: 'DEFLATE',
})
await fs.writeFile(outPath, buf)
await fs.writeFile(publicOutPath, buf)
console.log(`Wrote ${outPath} (${buf.length} bytes)`)
console.log(`Wrote ${publicOutPath}`)
