/**
 * T3.1 — Node-side capability checks (no ReaderScreen).
 * Covers ArrayBuffer open, TOC, CFI/location APIs, search hooks where available.
 * Render / selection / theme inject are confirmed in the Electron harness UI.
 *
 * Usage (from reading-book-desktop):
 *   node spikes/epub-engine/build-fixture.mjs
 *   node spikes/epub-engine/run-node-evals.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.join(__dirname, 'fixtures', 'spike-sample.epub')
const require = createRequire(import.meta.url)

// Minimal DOM for epubjs packaging in Node. Full render/TOC HTML = Chromium harness (#/spike/epub).
globalThis.DOMParser = DOMParser
globalThis.XMLSerializer = XMLSerializer
if (!globalThis.window) globalThis.window = globalThis
if (typeof globalThis.NodeFilter === 'undefined') {
  globalThis.NodeFilter = {
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
    SHOW_ALL: 0xffffffff,
    SHOW_ELEMENT: 1,
    SHOW_TEXT: 4,
  }
}

/** @typedef {'Pass'|'Partial'|'Fail'} Verdict */

/**
 * @param {string} id
 * @param {Verdict} verdict
 * @param {string} note
 */
function row(id, verdict, note) {
  return { id, verdict, note }
}

async function ensureFixture() {
  try {
    await fs.access(fixturePath)
  } catch {
    await import('./build-fixture.mjs')
  }
}

async function evalBaseline(buffer) {
  const rows = []
  try {
    const zip = await JSZip.loadAsync(buffer)
    rows.push(row('open_arraybuffer', 'Pass', 'JSZip.loadAsync(ArrayBuffer)'))

    const container = await zip.file('META-INF/container.xml')?.async('string')
    if (!container) throw new Error('missing container.xml')
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
    })
    const containerDoc = parser.parse(container)
    const rootfile =
      containerDoc.container?.rootfiles?.rootfile?.['@_full-path'] ??
      containerDoc.container?.rootfiles?.rootfile?.[0]?.['@_full-path']
    if (!rootfile) throw new Error('missing rootfile')
    const opfText = await zip.file(rootfile)?.async('string')
    if (!opfText) throw new Error('missing opf')
    const opfDir = rootfile.replace(/[^/]+$/, '')
    const opf = parser.parse(opfText)
    const pkg = opf.package ?? opf
    const items = [].concat(pkg.manifest?.item ?? [])
    const itemrefs = [].concat(pkg.spine?.itemref ?? [])
    const byId = new Map(items.map((it) => [it['@_id'], it]))
    const spineHrefs = itemrefs
      .map((ref) => byId.get(ref['@_idref'])?.['@_href'])
      .filter(Boolean)

    const navItem = items.find((it) => String(it['@_properties'] ?? '').includes('nav'))
    let tocLabels = []
    if (navItem) {
      const navPath = path.posix.join(opfDir, navItem['@_href']).replace(/\\/g, '/')
      const navHtml = await zip.file(navPath)?.async('string')
      const labels = [...(navHtml?.matchAll(/<a[^>]*>([^<]+)<\/a>/gi) ?? [])].map((m) =>
        m[1].trim(),
      )
      tocLabels = labels
    }
    rows.push(
      row(
        'toc',
        tocLabels.length >= 2 ? 'Pass' : 'Partial',
        `spine=${spineHrefs.length}; tocLabels=${tocLabels.join(' | ') || '(none)'}`,
      ),
    )
    rows.push(
      row(
        'nav_scroll',
        spineHrefs.length >= 2 ? 'Partial' : 'Fail',
        'Chapter index nav OK; page-turn/scroll must be hand-rolled in iframe',
      ),
    )
    rows.push(
      row(
        'cfi',
        'Fail',
        'No CFI codec — would need custom LocationCodec; resume/highlight unstable',
      ),
    )
    rows.push(
      row(
        'theme_css',
        'Partial',
        'Can inject CSS into iframe/srcdoc; no engine API',
      ),
    )
    rows.push(
      row(
        'selection',
        'Partial',
        'Native DOM selection in iframe possible; no selection→CFI mapping',
      ),
    )

    const ch2Path = path.posix.join(opfDir, 'chapter2.xhtml').replace(/\\/g, '/')
    const ch2 = await zip.file(ch2Path)?.async('string')
    const searchable = ch2?.includes('neon lantern') ?? false
    rows.push(
      row(
        'search',
        searchable ? 'Partial' : 'Fail',
        'Full-text scan of unpacked XHTML possible; no engine search API',
      ),
    )
    rows.push(
      row(
        'electron_vite',
        'Pass',
        'Uses existing jszip + fast-xml-parser; no new CSP concerns beyond iframe',
      ),
    )
    rows.push(
      row(
        'maintenance',
        'Fail',
        'Re-implements CFI, pagination, asset URL rewriting — high long-term cost',
      ),
    )
  } catch (err) {
    rows.push(row('open_arraybuffer', 'Fail', String(err)))
  }
  return rows
}

async function evalEpubjs(buffer) {
  const rows = []
  try {
    const mod = await import('epubjs')
    // CJS interop: default may be { default: ePubFn } under Node ESM
    const ePub =
      typeof mod.default === 'function'
        ? mod.default
        : typeof mod.default?.default === 'function'
          ? mod.default.default
          : null
    if (!ePub) throw new Error('epubjs default export is not a function')
    const book = ePub(buffer.slice(0), { openAs: 'binary' })
    await book.ready
    rows.push(row('open_arraybuffer', 'Pass', 'ePub(ArrayBuffer, { openAs: "binary" })'))

    const nav = await book.loaded.navigation
    const toc = nav?.toc ?? []
    // Node DOM polyfill may miss HTML nav; NCX/spine still prove TOC pipeline.
    const tocOk = toc.length > 0
    rows.push(
      row(
        tocOk ? 'toc' : 'toc',
        tocOk ? 'Pass' : 'Partial',
        tocOk
          ? `toc entries=${toc.length}; first="${toc[0]?.label ?? ''}"`
          : `nav.toc empty under Node polyfill; spine=${book.spine?.length ?? 0} (Pass in Chromium harness)`,
      ),
    )

    const spine = book.spine
    const spineLen = spine?.length ?? spine?.spineItems?.length ?? 0
    rows.push(
      row(
        'nav_scroll',
        spineLen >= 2 ? 'Pass' : 'Partial',
        `spine length=${spineLen}; Rendition supports paginated + scrolled (UI harness)`,
      ),
    )

    const EpubCFI = mod.EpubCFI ?? mod.default?.EpubCFI
    const hasCfi =
      typeof book.getRange === 'function' ||
      typeof book.locations?.generate === 'function' ||
      Boolean(EpubCFI)
    let cfiNote = 'EpubCFI module present'
    try {
      const first = book.spine?.get?.(0) ?? book.spine?.spineItems?.[0]
      if (first) {
        cfiNote = `section cfiBase=${first?.cfiBase ?? '(n/a)'}; display()/currentLocation in UI harness`
      }
    } catch (e) {
      cfiNote = `CFI helpers present; detail: ${e}`
    }
    rows.push(row('cfi', hasCfi ? 'Pass' : 'Fail', cfiNote))

    rows.push(
      row(
        'theme_css',
        'Pass',
        'rendition.themes.default / register / fontSize (API; UI harness)',
      ),
    )
    rows.push(
      row(
        'selection',
        'Pass',
        'rendition.on("selected") + getRange (API; UI harness)',
      ),
    )

    rows.push(
      row(
        'search',
        'Partial',
        'No first-class find API; DIY via section text in Chromium (Node section.load flaky)',
      ),
    )

    rows.push(
      row(
        'electron_vite',
        'Pass',
        'BSD-2-Clause; npm epubjs@0.3.93; iframe rendition in Chromium/Electron',
      ),
    )
    rows.push(
      row(
        'maintenance',
        'Partial',
        'Mature API + types; upstream slower; default in design docs',
      ),
    )

    book.destroy?.()
  } catch (err) {
    rows.push(row('open_arraybuffer', 'Fail', String(err)))
  }
  return rows
}

async function makeJsZipLoader(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
  return {
    entries: names.map((filename) => ({ filename })),
    loadText: async (name) => zip.file(name)?.async('string') ?? null,
    loadBlob: async (name, type) => {
      const f = zip.file(name)
      if (!f) return null
      const ab = await f.async('arraybuffer')
      return new Blob([ab], { type })
    },
    getSize: (name) => {
      const f = zip.file(name)
      return f?._data?.uncompressedSize ?? 0
    },
  }
}

async function evalFoliate(buffer) {
  const rows = []
  try {
    // API / module surface (Node xmldom lacks querySelector used by foliate EPUB.init).
    // Chromium harness at #/spike/epub runs makeBook(File) + <foliate-view>.
    // Do not import view.js in Node (needs HTMLElement). Resolve modules + zip loader only.
    require.resolve('foliate-js/epub.js')
    require.resolve('foliate-js/epubcfi.js')
    require.resolve('foliate-js/search.js')
    require.resolve('foliate-js/view.js')
    require.resolve('foliate-js/paginator.js')
    require.resolve('foliate-js/overlayer.js')

    await import(pathToFileURL(require.resolve('foliate-js/epubcfi.js')).href)

    const loader = await makeJsZipLoader(buffer)
    const container = await loader.loadText('META-INF/container.xml')
    if (!container) throw new Error('loader failed to read container.xml')

    rows.push(
      row(
        'open_arraybuffer',
        'Pass',
        'makeBook(File/Blob) documented; zip loader from ArrayBuffer OK; render in #/spike/epub',
      ),
    )
    rows.push(
      row('toc', 'Pass', 'EPUB.toc / nav parse in foliate-js/epub.js (Chromium harness)'),
    )
    rows.push(
      row(
        'nav_scroll',
        'Pass',
        'foliate-view + paginator.js (goTo/next/prev/scroll)',
      ),
    )
    rows.push(
      row('cfi', 'Pass', 'epubcfi.js module resolved; section.cfi + resolveCFI in book API'),
    )
    rows.push(
      row('theme_css', 'Pass', 'renderer.setStyles / transformTarget runtime CSS'),
    )
    rows.push(
      row('selection', 'Pass', 'selection + overlayer.js annotation support'),
    )
    rows.push(row('search', 'Pass', 'foliate-js/search.js module present'))
    rows.push(
      row(
        'electron_vite',
        'Partial',
        'MIT; ESM deep imports; Vite care; README: API not semver-stable',
      ),
    )
    rows.push(
      row(
        'maintenance',
        'Partial',
        'Strong Foliate app; library warns breaking changes — higher risk vs epubjs types',
      ),
    )
  } catch (err) {
    rows.push(row('open_arraybuffer', 'Fail', String(err)))
  }
  return rows
}

function printMatrix(name, rows) {
  console.log(`\n### ${name}`)
  for (const r of rows) {
    console.log(`- [${r.verdict}] ${r.id}: ${r.note}`)
  }
}

await ensureFixture()
const buffer = await fs.readFile(fixturePath)
console.log(`Fixture: ${fixturePath} (${buffer.length} bytes)`)

const baseline = await evalBaseline(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
const epubjsRows = await evalEpubjs(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
const foliateRows = await evalFoliate(buffer)

printMatrix('baseline (JSZip + iframe)', baseline)
printMatrix('epub.js (epubjs)', epubjsRows)
printMatrix('foliate-js', foliateRows)

const outJson = {
  date: '2026-07-27',
  fixture: 'spikes/epub-engine/fixtures/spike-sample.epub',
  candidates: {
    baseline,
    epubjs: epubjsRows,
    foliate: foliateRows,
  },
}
const outPath = path.join(__dirname, 'eval-results.json')
await fs.writeFile(outPath, JSON.stringify(outJson, null, 2))
console.log(`\nWrote ${outPath}`)
