/**
 * Checks for the shared Hand-tool rules (docs/implementation_plan/hand_mode_unified.md). Pure logic
 * on the real `reader/interaction/hand-gesture.ts`, plus static checks that the PDF and placeholder
 * surfaces are wired to it. No DOM.
 *
 *   1. hover dwell     -> arms only after resting on a target; skimming never arms; leaving / disarm /
 *                         dispose cancel; one callback per transition
 *   2. click vs drag   -> PAN_DRAG_THRESHOLD_PX boundary; center-tap zone edges
 *   3. wiring (static) -> PdfRenderer + ReadingCanvas use the shared dwell; PDF CSS has grab /
 *                         hover-text / grabbing rules; EPUB still uses the same constants
 *
 * Not covered (needs the running app): real cursors, native selection, pointer capture, scrolling.
 *
 * Run: npm run spike:reader:hand
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hand = await import('../../src/reader/interaction/hand-gesture.ts')
const hit = await import('../../src/reader/interaction/interaction-hit.ts')
const { createHandHoverDwell, exceedsDragThreshold, isInCenterTapZone } = hand

let passed = 0
async function check(name, fn) {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const DELAY = 30

function recorder() {
  const calls = []
  const dwell = createHandHoverDwell((armed) => calls.push(armed), DELAY)
  return { calls, dwell }
}

console.log('1. hover dwell')
await check('default delay is the EPUB one (300 ms)', () => {
  assert.equal(hit.HAND_HOVER_CURSOR_DELAY_MS, 300)
})
await check('arms only after resting on a target for the delay', async () => {
  const { calls, dwell } = recorder()
  dwell.update(true)
  assert.equal(dwell.isArmed(), false)
  await sleep(DELAY / 2)
  dwell.update(true) // same target again: does not restart the timer
  assert.equal(dwell.isArmed(), false)
  await sleep(DELAY)
  assert.equal(dwell.isArmed(), true)
  assert.deepEqual(calls, [true])
  dwell.dispose()
})
await check('skimming across text never arms', async () => {
  const { calls, dwell } = recorder()
  dwell.update(true)
  await sleep(DELAY / 3)
  dwell.update(false)
  dwell.update(true)
  await sleep(DELAY / 3)
  dwell.update(false)
  await sleep(DELAY * 2)
  assert.equal(dwell.isArmed(), false)
  assert.deepEqual(calls, [])
})
await check('leaving the target disarms; moving within it stays armed', async () => {
  const { calls, dwell } = recorder()
  dwell.update(true)
  await sleep(DELAY * 2)
  dwell.update(true)
  assert.equal(dwell.isArmed(), true)
  dwell.update(false)
  assert.equal(dwell.isArmed(), false)
  assert.deepEqual(calls, [true, false])
})
await check('disarm cancels a pending arm and an armed state', async () => {
  const { calls, dwell } = recorder()
  dwell.update(true)
  dwell.disarm()
  await sleep(DELAY * 2)
  assert.deepEqual(calls, [])
  dwell.update(true)
  await sleep(DELAY * 2)
  dwell.disarm()
  assert.deepEqual(calls, [true, false])
  // After a disarm (pan start) the same target must dwell again before re-arming.
  dwell.update(true)
  assert.equal(dwell.isArmed(), false)
  await sleep(DELAY * 2)
  assert.equal(dwell.isArmed(), true)
  dwell.dispose()
})
await check('dispose cancels the timer without a callback', async () => {
  const { calls, dwell } = recorder()
  dwell.update(true)
  dwell.dispose()
  await sleep(DELAY * 2)
  assert.deepEqual(calls, [])
})

console.log('2. click vs drag')
await check('drag threshold is PAN_DRAG_THRESHOLD_PX (4 px)', () => {
  assert.equal(hit.PAN_DRAG_THRESHOLD_PX, 4)
  assert.equal(exceedsDragThreshold(10, 10, 13, 10), false)
  assert.equal(exceedsDragThreshold(10, 10, 14, 10), true)
  assert.equal(exceedsDragThreshold(0, 0, 3, 3), true) // hypot ≈ 4.24
})
await check('center-tap zone is the middle half', () => {
  const area = { left: 100, width: 400 }
  assert.equal(isInCenterTapZone(199, area), false)
  assert.equal(isInCenterTapZone(200, area), true)
  assert.equal(isInCenterTapZone(400, area), true)
  assert.equal(isInCenterTapZone(401, area), false)
  assert.equal(isInCenterTapZone(10, { left: 0, width: 0 }), false)
})

console.log('3. wiring (static)')
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const pdf = read('../../src/reader/renderers/pdf/PdfRenderer.tsx')
const canvas = read('../../src/screens/Reader/components/canvas/ReadingCanvas.tsx')
const css = read('../../src/index.css')
const epub = read('../../src/reader/renderers/epub/EpubRenderer.tsx')
await check('PDF: shared dwell, armed text selects, everything else pans', () => {
  assert.match(pdf, /createHandHoverDwell\(/)
  assert.match(pdf, /dwellRef\.current\?\.isArmed\(\) && isTextAt\(/)
  assert.match(pdf, /exceedsDragThreshold\(/)
  assert.match(pdf, /isInCenterTapZone\(/)
  assert.match(pdf, /window\.addEventListener\('blur'/)
})
await check('PDF CSS: select, grab, hover-text I-beam, grabbing', () => {
  for (const selector of [
    "[data-pdf-tool='select']",
    "[data-pdf-tool='hand'] .textLayer :is(span, br)",
    "[data-pdf-tool='hand'][data-pdf-hover-text] .textLayer :is(span, br)",
    "[data-pdf-tool='hand'][data-pdf-grabbing] *",
  ]) {
    assert.ok(css.includes(selector), selector)
  }
})
await check('placeholder canvas: shared dwell for Hand', () => {
  assert.match(canvas, /createHandHoverDwell\(/)
  assert.match(canvas, /isHandHoverCursorTargetAtPoint\(/)
})
await check('EPUB still runs the same rules with the same constants', () => {
  assert.match(epub, /HAND_HOVER_CURSOR_DELAY_MS\)/)
  assert.match(epub, /PAN_DRAG_THRESHOLD_PX/)
  assert.match(epub, /isHandHoverCursorTargetAtPoint\(/)
})

console.log(`\n${passed} checks passed`)
