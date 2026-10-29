/**
 * PDF file attachment (specs/007-pdf-file-attachment) — M0 memory gate (research R3).
 *
 * For each PDF size × attachment size × content kind, on real temp files:
 *   1. scan + plan in a worker with the app's heap limit (SCAN_WORKER_HEAP_LIMIT_MB);
 *   2. stage + stream the update in this thread (the REAL `stageAttachmentSource` / `writeAttachmentUpdate`);
 *   3. read the temp file back in the worker (the REAL `verifyPdfAttachmentBytes`) — the peak;
 *   4. an ordinary annotation write and an open scan of the result (later costs of a bigger file).
 * Prints a table (time, peak V8 heap and external memory per step) and the largest PDF + content total that
 * passed. Exits non-zero when a combination fails or crashes the worker.
 *
 * Run: npm run spike:pdf:attachment-memory             (full matrix, several minutes)
 *      npm run spike:pdf:attachment-memory -- --quick  (1 MB / 50 MB only)
 */
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { buildPdf } from './pdf-fixtures.mjs'

const { stageAttachmentSource, writeAttachmentUpdate } = await import('../../electron/pdf-sync/pdf-attachment-writer.ts')

/** Mirrors `SCAN_WORKER_HEAP_LIMIT_MB` in electron/ipc/overlay.ipc.ts. */
const HEAP_LIMIT_MB = Number(/SCAN_WORKER_HEAP_LIMIT_MB = (\d+)/.exec(fs.readFileSync(new URL('../../electron/ipc/overlay.ipc.ts', import.meta.url), 'utf8'))?.[1])
if (!HEAP_LIMIT_MB) throw new Error('SCAN_WORKER_HEAP_LIMIT_MB not found in overlay.ipc.ts')

const MB = 1024 * 1024
const quick = process.argv.includes('--quick')
const PDF_SIZES = quick ? [1, 50] : [1, 50, 200]
const CONTENT_SIZES = quick ? [1, 50] : [1, 50, 100]
const KINDS = ['text', 'random']

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'readmate-attach-mem-'))
const staging = path.join(dir, 'staging')

function startWorker() {
  return new Worker(new URL('./attachment-memory.worker.mjs', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: HEAP_LIMIT_MB } })
}

let worker = startWorker()
function ask(request, transfer = []) {
  return new Promise((resolve, reject) => {
    const onMessage = (reply) => {
      cleanup()
      resolve(reply)
    }
    const onError = (err) => {
      cleanup()
      worker = startWorker()
      reject(err)
    }
    const cleanup = () => {
      worker.off('message', onMessage)
      worker.off('error', onError)
    }
    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.postMessage(request, transfer)
  })
}

async function writeContent(file, sizeMb, kind) {
  const handle = await fsp.open(file, 'w')
  const chunk = kind === 'text' ? Buffer.from('Readmate attachment memory check. '.repeat(31000)).subarray(0, MB) : null
  for (let i = 0; i < sizeMb; i++) await handle.write(chunk ?? randomBytes(MB))
  await handle.close()
}

function pdfOf(sizeMb) {
  // Bulk = a document-level embedded file of random bytes (never read by the scan / verify paths' page loop).
  const bulk = sizeMb > 1 ? randomBytes(sizeMb * MB - 4096) : new Uint8Array(0)
  return buildPdf({ pages: 3, docFiles: bulk.length ? [{ name: 'bulk.bin', data: bulk }] : [] })
}

const mb = (n) => (n / MB).toFixed(0).padStart(4)
const rows = []
let failures = 0
let largestPassed = 0

for (const pdfMb of PDF_SIZES) {
  const pdfBytes = pdfOf(pdfMb)
  const target = path.join(dir, `book-${pdfMb}.pdf`)
  for (const contentMb of CONTENT_SIZES) {
    for (const kind of KINDS) {
      const label = `PDF ${String(pdfMb).padStart(3)} MB + ${String(contentMb).padStart(3)} MB ${kind.padEnd(6)}`
      const row = { label, steps: {} }
      try {
        await fsp.writeFile(target, pdfBytes)
        const source = path.join(dir, `content-${contentMb}-${kind}.bin`)
        if (!fs.existsSync(source)) await writeContent(source, contentMb, kind)

        const scan = await ask({ kind: 'scan', bytes: pdfBytes })
        if (!scan.ok) throw new Error(`scan: ${scan.error}`)
        row.steps.scan = scan
        const page = scan.result.pages[0]

        const started = performance.now()
        const staged = await stageAttachmentSource(source, staging, { pdfSizeBytes: pdfBytes.length })
        if (!staged.ok) throw new Error(`stage: ${staged.code}`)
        row.steps.stage = { ms: performance.now() - started }

        const annotation = { nm: 'readmate:00000000-0000-4000-8000-000000000001', pageIndex: 0, box: { x: 0.4, y: 0.4, width: 0.1, height: 0.1 }, color: [0.2, 0.4, 0.8], author: 'Readmate', contents: 'content.bin', createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString() }
        const file = { name: 'content.bin', sizeBytes: staged.staged.sizeBytes, md5Hex: staged.staged.md5Hex, modifiedAt: staged.staged.modifiedAt }
        const plan = await ask({ kind: 'plan', bytes: pdfBytes, page, annotation, file })
        if (!plan.ok) throw new Error(`plan: ${plan.error}`)
        row.steps.plan = plan

        const writeStarted = performance.now()
        await writeAttachmentUpdate({
          target,
          bytes: pdfBytes,
          bytesSha256: createHash('sha256').update(pdfBytes).digest('hex'),
          plan: plan.result,
          content: { stagedPath: staged.staged.stagedPath, sha256: staged.staged.sha256 },
          verify: async (tempPath) => {
            const bytes = new Uint8Array(await fsp.readFile(tempPath))
            const verified = await ask(
              { kind: 'verify', bytes, expect: { annotationId: `${plan.result.annotationRef.num}R`, pageIndex: 0, present: { rect: plan.result.rect, sha256: staged.staged.sha256 }, keepIds: scan.result.ids } },
              [bytes.buffer],
            )
            row.steps.verify = verified
            if (!verified.ok) return `verify crashed: ${verified.error}`
            return verified.result.ok ? null : verified.result.detail
          },
        })
        row.steps.write = { ms: performance.now() - writeStarted - (row.steps.verify?.ms ?? 0) }
        await staged.staged.cleanup()

        const written = new Uint8Array(await fsp.readFile(target))
        row.outputMb = written.length / MB
        const highlight = { nm: 'readmate:00000000-0000-4000-8000-000000000002', subtype: 'Highlight', pageIndex: 0, rects: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.05 }], color: [1, 1, 0], opacity: 0.4, author: 'Readmate', createdAt: annotation.createdAt, modifiedAt: annotation.createdAt }
        const ordinary = await ask({ kind: 'ordinary-write', bytes: written, page, annotation: highlight })
        if (!ordinary.ok) throw new Error(`ordinary write: ${ordinary.error}`)
        row.steps.ordinary = ordinary
        const reopen = await ask({ kind: 'scan', bytes: written })
        if (!reopen.ok) throw new Error(`open scan: ${reopen.error}`)
        row.steps.reopen = reopen
        row.ok = true
        largestPassed = Math.max(largestPassed, pdfBytes.length + contentMb * MB)
      } catch (err) {
        row.ok = false
        row.error = err instanceof Error ? err.message : String(err)
        failures++
      }
      rows.push(row)
      const s = row.steps
      const fmt = (step) => (step ? `${String(Math.round(step.ms)).padStart(6)} ms${step.peakHeap ? ` heap${mb(step.peakHeap)} MB` : ''}` : '      —')
      console.log(
        `${row.ok ? 'ok  ' : 'FAIL'} ${label} | stage ${fmt(s.stage)} | plan ${fmt(s.plan)} | write ${fmt(s.write)} | verify ${fmt(s.verify)} | next write ${fmt(s.ordinary)} | open scan ${fmt(s.reopen)}${row.outputMb ? ` | out ${row.outputMb.toFixed(1)} MB` : ''}${row.error ? ` | ${row.error}` : ''}`,
      )
    }
  }
}

await worker.terminate()
await fsp.rm(dir, { recursive: true, force: true })
console.log(`\nworker heap limit ${HEAP_LIMIT_MB} MB; largest PDF + content that passed: ${(largestPassed / MB).toFixed(1)} MB (${largestPassed} bytes)`)
console.log(failures ? `${failures} combination(s) failed` : 'all combinations passed')
process.exit(failures ? 1 : 0)
