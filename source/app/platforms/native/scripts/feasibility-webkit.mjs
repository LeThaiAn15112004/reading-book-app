#!/usr/bin/env node
// M2 early warning (T022): opens each sample book of the feasibility build in Playwright, at phone size.
// WebKit here is NOT iOS: a pass proves nothing about a device. Chromium is the control, so a problem seen in
// both comes from the harness or the UI, and only a WebKit-only difference is an early warning.
// Needs: npm run build:web:feasibility, npx playwright install webkit chromium
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit } from 'playwright'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(appRoot, 'web-dist')
const outIndex = process.argv.indexOf('--out')
const outDir = outIndex > 0 ? process.argv[outIndex + 1] : null

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
}

/** Same behaviour as the native server: Range, 416, nothing outside the folder. */
function serve(request, response) {
  const urlPath = decodeURIComponent(new URL(request.url, 'http://x').pathname)
  const file = path.join(dist, urlPath === '/' ? 'index.html' : urlPath)
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404).end()
    return
  }
  const size = statSync(file).size
  const headers = { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes' }
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '')
  if (!match) {
    response.writeHead(200, { ...headers, 'Content-Length': size })
    createReadStream(file).pipe(response)
    return
  }
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (start >= size) {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
    return
  }
  response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
  createReadStream(file, { start, end }).pipe(response)
}

/** What "the book is showing" means per format, read from the page itself. */
const BOOKS = [
  { id: 'feas-epub', probe: () => {
    const frame = document.querySelector('iframe')
    return (frame?.contentDocument?.body?.innerText ?? '').trim().length
  } },
  { id: 'feas-pdf', probe: () => {
    const canvas = document.querySelector('canvas')
    const text = document.querySelector('.textLayer')?.textContent ?? ''
    return canvas && canvas.width > 0 ? text.length + 1 : 0
  } },
  { id: 'feas-txt', probe: () => document.querySelector('textarea')?.value.length ?? 0 },
  { id: 'feas-md', probe: () => (document.body.innerText.includes('Section') ? 1 : 0) },
]

async function runBrowser(name, browserType, baseUrl) {
  const browser = await browserType.launch()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const results = []

  const open = async (label, hash, probe) => {
    const page = await context.newPage()
    const errors = []
    const external = []
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`)
    })
    page.on('request', (request) => {
      if (!request.url().startsWith(baseUrl) && /^https?:/.test(request.url())) external.push(request.url())
    })
    await page.goto(`${baseUrl}/index.html${hash}`)
    let shown = false
    try {
      await page.waitForFunction(probe, null, { timeout: 30_000 })
      shown = true
    } catch {
      shown = false
    }
    await page.waitForTimeout(1000)
    if (outDir) await page.screenshot({ path: path.join(outDir, `${name}-${label}.png`) })
    results.push({ browser: name, label, shown, errors: errors.slice(0, 5), errorCount: errors.length, external })
    await page.close()
  }

  await open('library', '#/library', () => document.body.innerText.includes('Sample PDF'))
  for (const book of BOOKS) await open(book.id, `#/reader/${book.id}`, book.probe)
  await browser.close()
  return results
}

if (!existsSync(path.join(dist, 'feasibility', 'manifest.json'))) {
  console.error('Run `npm run build:web:feasibility` first.')
  process.exit(2)
}
if (outDir) mkdirSync(outDir, { recursive: true })

const server = createServer(serve)
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`
const all = []
for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
  try {
    all.push(...(await runBrowser(name, type, baseUrl)))
  } catch (error) {
    all.push({ browser: name, label: 'launch', shown: false, errors: [String(error).slice(0, 300)], errorCount: 1, external: [] })
  }
}
server.close()

for (const row of all) {
  console.log(`${row.browser.padEnd(9)} ${row.label.padEnd(10)} ${row.shown ? 'shown ' : 'NOT SHOWN'} errors=${row.errorCount} external=${row.external.length}`)
  for (const error of row.errors) console.log(`    ${error.slice(0, 220)}`)
  for (const url of row.external) console.log(`    external: ${url}`)
}
process.exit(all.every((row) => row.shown && row.external.length === 0) ? 0 : 1)
