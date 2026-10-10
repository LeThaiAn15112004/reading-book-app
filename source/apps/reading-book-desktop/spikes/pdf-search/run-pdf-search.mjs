/**
 * Checks for PDF text search (docs/implementation_plan/pdf_search.md). Real code, no Electron:
 *
 *   1. extraction      -> `pdfParagraphs` (electron/chunking/pdf-text.ts) with the installed pdf.js
 *                         legacy build: one paragraph per page with text, page index as chapter;
 *                         a scanned (image-only) PDF yields nothing
 *   2. Main matching   -> SDK `chunkParagraphs` + the real `findBookMatches`
 *                         (electron/search/book-search-query.ts) over an in-memory stand-in for the
 *                         FTS candidate query: page numbers, per-page occurrence ranks, repeated hits
 *   3. renderer text   -> `buildPdfTextLayerIndex` (reader/renderers/pdf/pdfSearchDom.ts) over a DOM
 *                         shaped exactly like PDF.js `TextLayer` output (span per item, <br> on EOL)
 *                         rebuilds Main's page text, so "occurrence k of page n" picks the same words
 *   4. query changes   -> case / whole-word / no-match queries
 *   5. no-text state   -> book-search-service returns `noText` (static check) and the panel says so
 *
 * Not covered (needs the running app): CSS highlight painting, scrolling to a hit, zoom/re-render
 * repaint, the chunk worker thread itself, real scanned PDFs from a scanner.
 *
 * Run: npm run spike:pdf:search
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

await import('./build-fixtures.mjs')

const { pdfParagraphs, pdfPageText } = await import('../../electron/chunking/pdf-text.ts')
const { findBookMatches } = await import('../../electron/search/book-search-query.ts')
const { buildPdfTextLayerIndex } = await import('../../src/reader/renderers/pdf/pdfSearchDom.ts')
const { pickSectionMatch } = await import('../../src/reader/renderers/epub/search/epubSearchDom.ts')
const sdk = await import('./sdk-stub.mjs')

let passed = 0
async function check(name, fn) {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url)
const fixturePath = (name) => decodeURIComponent(fixture(name).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

async function collect(name) {
  const out = []
  for await (const p of pdfParagraphs(fixturePath(name))) out.push(p)
  return out
}

/** Same shape the chunk worker stores, served back the way CANDIDATES_SQL does. */
function fakeDb(paragraphs) {
  const chunks = [...sdk.chunkParagraphs(paragraphs)]
  let wordStart = 0
  const rows = chunks.map((chunk) => {
    const row = {
      chunkIndex: chunk.chunkIndex,
      chapterIndex: JSON.parse(chunk.locationStart).chapterIndex,
      wordStart,
      content: chunk.content,
      score: 0,
    }
    wordStart += sdk.countSearchWords(chunk.content)
    return row
  })
  const stats = { chunkCount: rows.length, minSeq: 1, maxSeq: rows.length, totalWords: wordStart }
  // FTS5 is only a prefilter for findBookMatches; returning every chunk keeps the result exact.
  const db = { prepare: () => ({ get: () => stats, iterate: () => rows[Symbol.iterator]() }) }
  return { db, stats }
}

function search(paragraphs, raw, options = {}) {
  const query = sdk.parseTextSearchQuery(raw, { ...sdk.DEFAULT_TEXT_SEARCH_OPTIONS, ...options })
  if (!query) return []
  const { db, stats } = fakeDb(paragraphs)
  return findBookMatches(db, 'book', query, stats)
}

/** Minimal DOM nodes shaped like PDF.js TextLayer output for one page. */
function fakeTextLayer(items) {
  const children = []
  for (const item of items) {
    if (item.str) children.push({ nodeType: 1, localName: 'span', kids: [{ nodeType: 3, data: item.str, length: item.str.length }] })
    if (item.hasEOL) children.push({ nodeType: 1, localName: 'br', kids: [] })
  }
  const link = (list) => {
    list.forEach((node, i) => {
      node.nextSibling = list[i + 1] ?? null
      node.firstChild = node.kids?.[0] ?? null
      if (node.kids) link(node.kids)
    })
    return list[0] ?? null
  }
  return { firstChild: link(children) }
}

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
async function pageItems(name) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(fixture(name))), verbosity: 0 }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items)
  await doc.destroy()
  return pages
}

console.log('1. extraction')
const textParas = await collect('text.pdf')
await check('text PDF: one paragraph per page, chapterIndex = 0-based page', () => {
  assert.deepEqual(textParas.map((p) => p.chapterIndex), [0, 1, 2])
  assert.equal(textParas[0].text, 'Hello Readmate\nThe quick brown fox jumps.')
  assert.equal(textParas[1].text, 'A fox and another fox\nmet a third fox today.')
})
await check('scanned PDF: no text at all → no paragraphs (→ no chunks → noText)', async () => {
  assert.deepEqual(await collect('scanned.pdf'), [])
})
await check('pdfPageText skips marked-content items and honours hasEOL', () => {
  assert.equal(pdfPageText([{ type: 'beginMarkedContent' }, { str: 'a', hasEOL: true }, { str: 'b' }]), 'a\nb')
})

console.log('2. Main matching (real findBookMatches)')
await check('"fox": page numbers and per-page ranks, repeated hits on one page', () => {
  const hits = search(textParas, 'fox')
  assert.deepEqual(
    hits.map((h) => [h.chapterIndex + 1, h.chapterOccurrence, h.chapterMatchCount]),
    [[1, 0, 1], [2, 0, 3], [2, 1, 3], [2, 2, 3]],
  )
  assert.deepEqual(hits.map((h) => h.occurrence), [1, 2, 3, 4])
})
await check('phrase across a line break on one page', () => {
  const hits = search(textParas, 'Readmate The quick')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].chapterIndex, 0)
})

console.log('3. renderer text layer = Main page text')
const items = await pageItems('text.pdf')
await check('text layer index rebuilds the exact page text Main indexed', () => {
  items.forEach((pageItems, i) => {
    assert.equal(buildPdfTextLayerIndex(fakeTextLayer(pageItems)).text, textParas[i].text)
  })
})
await check('Main rank k on page 2 picks the k-th "fox" in the layer', () => {
  const matcher = sdk.createTextMatcher(sdk.parseTextSearchQuery('fox', sdk.DEFAULT_TEXT_SEARCH_OPTIONS))
  const index = buildPdfTextLayerIndex(fakeTextLayer(items[1]))
  const layerHits = matcher.find(index.text)
  for (const hit of search(textParas, 'fox').filter((h) => h.chapterIndex === 1)) {
    const picked = pickSectionMatch(layerHits, hit.chapterOccurrence, hit.chapterMatchCount)
    assert.equal(index.text.slice(picked.start, picked.end), 'fox')
    assert.equal(picked, layerHits[hit.chapterOccurrence])
  }
})

console.log('4. query changes')
await check('no match → empty, case-sensitive and whole-word options respected', () => {
  assert.equal(search(textParas, 'zebra').length, 0)
  assert.equal(search(textParas, 'hello').length, 1)
  assert.equal(search(textParas, 'hello', { matchCase: true }).length, 0)
  assert.equal(search(textParas, 'fo', { wholeWords: true }).length, 0)
})

console.log('5. no-text state (static)')
await check('search service answers an empty index with noText; panel and store handle it', () => {
  const service = readFileSync(new URL('../../electron/search/book-search-service.ts', import.meta.url), 'utf8')
  assert.match(service, /chunkCount === 0\) return \{ state: 'noText' \}/)
  const store = readFileSync(new URL('../../src/screens/Reader/logic/search/bookSearchStore.ts', import.meta.url), 'utf8')
  assert.match(store, /case 'noText':\s*\n\s*set\(\{ status: 'noText'/)
  const panel = readFileSync(new URL('../../src/screens/Reader/components/chrome/ReaderSearchPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /status === 'noText'/)
  const extract = readFileSync(new URL('../../electron/chunking/extract-book-text.ts', import.meta.url), 'utf8')
  assert.match(extract, /new Set\(\['epub', 'txt', 'md', 'pdf'\]\)/)
})

console.log(`\n${passed} checks passed`)
