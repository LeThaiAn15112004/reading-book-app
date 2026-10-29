/**
 * Worker side of `spike:pdf:attachment-memory`: the SAME scan / plan / verify / ordinary-write code the app's
 * scan worker runs, inside a worker started with the app's heap limit. Reports `process.memoryUsage()` after
 * each request so the parent can tabulate the peak.
 */
import { parentPort } from 'node:worker_threads'

const { scanPdfAnnotationBytes, verifyPdfAttachmentBytes } = await import('../../electron/pdf-sync/pdf-annotation-scan.ts')
const { planAttachmentAppend, appendAnnotationUpdate } = await import('../../electron/pdf-sync/pdf-incremental-writer.ts')

let peakHeap = 0
const sample = () => {
  const { heapUsed } = process.memoryUsage()
  if (heapUsed > peakHeap) peakHeap = heapUsed
}
const timer = setInterval(sample, 5)

parentPort.on('message', async (request) => {
  peakHeap = 0
  const started = performance.now()
  try {
    let result
    if (request.kind === 'scan') {
      const scanned = await scanPdfAnnotationBytes(request.bytes)
      result = { pages: scanned.pages, ids: scanned.items.map((i) => i.objectId) }
    } else if (request.kind === 'plan') {
      result = planAttachmentAppend(request.bytes, request.page, request.annotation, request.file)
    } else if (request.kind === 'verify') {
      result = await verifyPdfAttachmentBytes(request.bytes, request.expect)
    } else if (request.kind === 'ordinary-write') {
      const pages = new Map([[0, request.page]])
      const output = appendAnnotationUpdate(request.bytes, pages, { add: [request.annotation], replace: [], remove: [] })
      result = { size: output.length }
    }
    sample()
    const { heapUsed, external, arrayBuffers } = process.memoryUsage()
    parentPort.postMessage({ ok: true, result, ms: performance.now() - started, peakHeap: Math.max(peakHeap, heapUsed), external, arrayBuffers })
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err), ms: performance.now() - started })
  }
})

process.on('exit', () => clearInterval(timer))
