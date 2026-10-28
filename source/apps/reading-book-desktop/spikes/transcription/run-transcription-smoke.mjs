/**
 * GATE T014a — Whisper smoke test (spec 004), as amended by owner decision A (research R11): the speech engine runs in
 * a SEPARATE PROCESS owned by `speech-process-host.ts`, not in a worker thread. The first version of this gate (worker
 * thread) failed its abort criterion: killing a worker thread while ONNX Runtime runs crashes the whole process.
 *
 *   - the child is the BUILT bundle `dist-electron/transcription.process.js` (output of `vite build`, not TS sources),
 *     started through the real host (`createSpeechProcessHost` + `launchForkedProcess`);
 *   - the host script runs on Electron's Node (`ELECTRON_RUN_AS_NODE`, no window), standing in for Main;
 *   - the model is `whisper-tiny` from the verified local folder (downloaded ONCE by the real model manager if absent —
 *     this spike downloads without asking because it is a test; the app never does), loaded with network blocked.
 *
 * PASS needs ALL of:
 *   1. the model loads from the verified cache offline
 *   2. the fixture is transcribed with word error rate <= 25 % against the reference sentence
 *   3. segments are monotonic with startMs < endMs, inside the fixture length + 1 s
 *   4. the host's 100 ms heartbeat never gaps more than 500 ms during the WHOLE run (all scenarios below)
 *   5. the first transcription finishes within 120 s
 *   6. aborting mid-inference (default 2 s grace) rejects ABORTED within 5 s and the host stays alive
 *   7. a FORCED kill of the busy process (no grace) rejects ABORTED within 5 s and the host stays alive — the exact
 *      scenario that crashed the thread-based version
 *   8. the speech process killed from outside mid-inference (as a native crash would) fails only that request
 *      (DECODE_FAILED) and the host stays alive
 *   9. after 6–8 the same host transcribes the fixture again correctly (a fresh process was started)
 * A failure of criteria 1-3 or 5-9 = FAIL: stop and report; T015 and everything depending on it must not start.
 * Criterion 4 (host heartbeat <= 500 ms) is kept exactly as it is — threshold and assertion unchanged, and it still
 * reports FAIL (exit code 1) when it fails — but by OWNER DECISION (2026-10-27, research R12) a failure of criterion 4 ALONE
 * under heavy CPU load is a documented, non-blocking performance limitation: it does not stop the transcription service or the
 * user stories. Any other failure still does.
 *
 * Run: npm run spike:transcription:smoke   (builds the app bundles first; needs network only the first time)
 * Run it also under CPU load (e.g. N busy loops) — the abort criteria must hold there too.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { wordErrorRate } from './wer.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const desktop = path.resolve(here, '../..')
const REFERENCE = 'The quick brown fox jumps over the lazy dog. Reading a good book is a quiet pleasure.'
const MODEL_ID = 'whisper-tiny'
const MODELS_DIR = process.env.READMATE_TRANSCRIPTION_MODELS || path.join(os.tmpdir(), 'readmate-transcription-models')

if (!process.versions.electron) {
  // ---- phase 1 (plain node): bundle the host + model manager, then re-launch under Electron's Node ----
  const esbuild = require('esbuild')
  const sdk = path.resolve(desktop, '../book-reader-sdk/dist/index.mjs')
  assert.ok(fs.existsSync(sdk), 'build the SDK first (the npm script does)')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-transcription-smoke-'))
  const bundles = { manager: path.join(out, 'model-manager.mjs'), host: path.join(out, 'speech-process-host.mjs') }
  const plugin = { name: 'sdk', setup: (b) => b.onResolve({ filter: /^@reading-book\/book-reader-sdk$/ }, () => ({ path: sdk })) }
  await esbuild.build({ entryPoints: [path.join(desktop, 'electron/transcription/model-manager.ts')], outfile: bundles.manager, bundle: true, platform: 'node', format: 'esm', logLevel: 'error', plugins: [plugin] })
  await esbuild.build({ entryPoints: [path.join(desktop, 'electron/transcription/speech-process-host.ts')], outfile: bundles.host, bundle: true, platform: 'node', format: 'esm', logLevel: 'error', plugins: [plugin] })
  const electron = require('electron')
  const r = spawnSync(electron, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TRANSCRIPTION_SMOKE_MANAGER: bundles.manager, TRANSCRIPTION_SMOKE_HOST: bundles.host },
    stdio: 'inherit', windowsHide: true,
  })
  fs.rmSync(out, { recursive: true, force: true })
  if (r.status !== 0) console.log(`[launcher] the Electron-as-Node host ended abnormally: status=${r.status} (0x${(r.status >>> 0).toString(16)}) signal=${r.signal} error=${r.error?.message ?? 'none'}`)
  process.exit(r.status ?? 1)
}

// ---- phase 2 (Electron's Node) ----
const results = []
function criterion(n, name, ok, detail) {
  results.push({ n, name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}. ${name}${detail ? ` — ${detail}` : ''}`)
}
assert.equal(wordErrorRate('a b c d', 'a b c d'), 0)
assert.equal(wordErrorRate('a b c d', 'a x c d'), 0.25)
assert.equal(wordErrorRate('The Fox.', 'the fox'), 0)

const processPath = path.join(desktop, 'dist-electron/transcription.process.js')
assert.ok(fs.existsSync(processPath), `built speech process missing: ${processPath} (run \`npx vite build\`)`)

/** 16-bit PCM mono 16 kHz WAV → Float32Array. */
function readWav(file) {
  const b = fs.readFileSync(file)
  assert.equal(b.toString('ascii', 0, 4), 'RIFF'); assert.equal(b.toString('ascii', 8, 12), 'WAVE')
  let pos = 12, fmt = null, data = null
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4), size = b.readUInt32LE(pos + 4)
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(pos + 8), channels: b.readUInt16LE(pos + 10), rate: b.readUInt32LE(pos + 12), bits: b.readUInt16LE(pos + 22) }
    if (id === 'data') { data = b.subarray(pos + 8, pos + 8 + size); break }
    pos += 8 + size + (size % 2)
  }
  assert.ok(fmt && data, 'wav chunks')
  assert.deepEqual([fmt.format, fmt.channels, fmt.rate, fmt.bits], [1, 1, 16000, 16], 'fixture must be 16 kHz mono PCM16')
  const out = new Float32Array(data.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = data.readInt16LE(i * 2) / 32768
  return out
}
const fixture = readWav(path.join(here, 'fixtures/smoke-speech.wav'))
const fixtureSeconds = fixture.length / 16000
// 30 s of the fixture repeated: a window long enough that the run is still inferring when the abort arrives.
const long = new Float32Array(30 * 16000)
for (let i = 0; i < long.length; i += 1) long[i] = fixture[i % fixture.length]
console.log(`Electron-as-Node ${process.versions.node}; fixture ${fixtureSeconds.toFixed(2)} s; models dir ${MODELS_DIR}`)

// ---- the model: the real manager (download only because this is a test) ----
const { createModelManager } = await import(pathToFileURL(process.env.TRANSCRIPTION_SMOKE_MANAGER).href)
const { createSpeechProcessHost, launchForkedProcess, SpeechProcessError } = await import(pathToFileURL(process.env.TRANSCRIPTION_SMOKE_HOST).href)
const manager = createModelManager({ modelsDir: MODELS_DIR })
let installedNote = 'already installed'
if (!(await manager.isInstalled(MODEL_ID)) || !(await manager.verifyInstalled(MODEL_ID)).ok) {
  console.log(`Downloading ${MODEL_ID} with the model manager (test only; the app asks the user first)…`)
  let lastPct = -1
  await manager.download(MODEL_ID, { onProgress: (p) => { const pct = Math.floor((p.loadedBytes / p.totalBytes) * 10) * 10; if (pct !== lastPct) { lastPct = pct; console.log(`  ${pct}%`) } } })
  installedNote = 'downloaded + verified by the manager'
}
assert.equal((await manager.verifyInstalled(MODEL_ID)).ok, true, 'model must verify before the smoke test starts')
console.log(`Model ${MODEL_ID}: ${installedNote}; all files re-hashed OK\n`)

// ---- host-side heartbeat for the whole run ----
const hb = { last: performance.now(), maxGap: 0, ticks: 0, phase: 'start', slow: [] }
const timer = setInterval(() => {
  const now = performance.now()
  const gap = now - hb.last
  hb.maxGap = Math.max(hb.maxGap, gap)
  if (gap > 300) hb.slow.push(`${hb.phase}:${gap.toFixed(0)}ms`)
  hb.ticks += 1
  hb.last = now
}, 100)

// How long Main's thread is blocked by starting / killing a child (the real source of the long heartbeat gaps).
const blocking = { spawnMs: [], killMs: [], sendMs: [] }
const launcher = launchForkedProcess(processPath)
const timedLauncher = (data) => {
  const t = performance.now()
  const handle = launcher(data)
  blocking.spawnMs.push(performance.now() - t)
  const { kill, send } = handle
  return {
    ...handle,
    send: (m) => { const t1 = performance.now(); send(m); blocking.sendMs.push(performance.now() - t1) },
    kill: () => { const t2 = performance.now(); kill(); blocking.killMs.push(performance.now() - t2) },
  }
}
const newHost = (cancelGraceMs) => createSpeechProcessHost({ launch: timedLauncher, modelsDir: MODELS_DIR, blockNetwork: true, cancelGraceMs })
const request = (samples) => ({ modelId: MODEL_ID, language: 'en', samples })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Start a long request, wait until it is really inferring, then run `action`; resolve with how the request ended. */
async function disturbWhileInferring(host, action) {
  const stages = []
  const ctl = new AbortController()
  const outcome = host.transcribe(request(long), { signal: ctl.signal, onStage: (s) => stages.push(s) }).then(
    (result) => ({ ok: true, result }),
    (error) => ({ ok: false, error }),
  )
  const deadline = performance.now() + 60_000
  while (!stages.includes('transcribing') && performance.now() < deadline) await sleep(20)
  await sleep(150)
  const at = performance.now()
  await action(ctl)
  const ended = await Promise.race([outcome, sleep(20_000).then(() => ({ ok: false, error: new Error('still pending after 20 s') }))])
  return { ...ended, ms: performance.now() - at, stages }
}

console.log('Smoke test results')
let host = null
try {
  host = newHost(2000)
  hb.phase = 'first request (spawn + model load + transcribe)'

  // ---- 1-5: transcribe the fixture ----
  const stages = []
  const started = performance.now()
  const first = await host.transcribe(request(fixture), { onStage: (s) => stages.push(s) }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }))
  const elapsedMs = performance.now() - started
  criterion(1, 'the model loads from the verified cache offline (network blocked in the speech process)', first.ok && stages.includes('ready'),
    first.ok ? `stages: ${stages.join(' → ')}, load ${first.r.loadMs} ms` : `${first.e?.code ?? ''} ${String(first.e?.message).slice(0, 300)}`)
  if (first.ok) {
    const text = first.r.segments.map((s) => s.text).join(' ')
    console.log(`        transcript: "${text}"`)
    const wer = wordErrorRate(REFERENCE, text)
    criterion(2, 'word error rate <= 25 %', wer <= 0.25, `WER ${(wer * 100).toFixed(1)} %`)
    const limitMs = fixtureSeconds * 1000 + 1000
    const monotonic = first.r.segments.length > 0 && first.r.segments.every((s, i, a) =>
      Number.isInteger(s.startMs) && Number.isInteger(s.endMs) && s.startMs >= 0 && s.startMs < s.endMs && s.endMs <= limitMs && (i === 0 || s.startMs >= a[i - 1].startMs))
    criterion(3, 'segments monotonic, startMs < endMs, inside fixture length + 1 s', monotonic, JSON.stringify(first.r.segments.map((s) => [s.startMs, s.endMs])))
    criterion(5, 'first transcription finished within 120 s', elapsedMs <= 120_000, `${(elapsedMs / 1000).toFixed(1)} s (load ${first.r.loadMs} ms + transcribe ${first.r.transcribeMs} ms)`)
  } else {
    criterion(2, 'word error rate <= 25 %', false, 'no transcript')
    criterion(3, 'segments monotonic, startMs < endMs, inside fixture length + 1 s', false, 'no transcript')
    criterion(5, 'first transcription finished within 120 s', false, 'no transcript')
  }

  // ---- 6: abort mid-inference (default grace) ----
  hb.phase = 'abort with grace (long request, cancel, kill)'
  const abortRun = await disturbWhileInferring(host, (ctl) => ctl.abort())
  const aborted = !abortRun.ok && abortRun.error instanceof SpeechProcessError && abortRun.error.code === 'ABORTED'
  const hard6 = aborted && /did not answer/.test(abortRun.error.message)
  criterion(6, 'abort mid-inference (2 s grace) rejects ABORTED within 5 s, host alive', aborted && abortRun.ms <= 5000,
    `${hard6 ? 'forced kill after the grace period' : 'graceful (the process answered the cancel)'}; ${abortRun.ms.toFixed(0)} ms${aborted ? '' : `; got ${abortRun.ok ? 'a result' : abortRun.error?.code + ' ' + abortRun.error?.message}`}`)

  // ---- 7: forced kill of the busy process (no grace): the scenario that crashed the thread-based version ----
  hb.phase = 'forced kill host (spawn + warm-up + long request + kill)'
  const forcedHost = newHost(1)
  const warm = await forcedHost.transcribe(request(fixture)).then(() => true, () => false)   // a resident, loaded model
  const forced = warm ? await disturbWhileInferring(forcedHost, (ctl) => ctl.abort()) : { ok: false, error: new Error('warm-up failed'), ms: 0 }
  const forcedOk = !forced.ok && forced.error instanceof SpeechProcessError && forced.error.code === 'ABORTED'
  criterion(7, 'forced kill of the busy speech process rejects ABORTED within 5 s, host alive', forcedOk && forced.ms <= 5000,
    `${forced.ms.toFixed(0)} ms${forcedOk ? '' : `; got ${forced.ok ? 'a result' : forced.error?.code + ' ' + forced.error?.message}`}`)
  forcedHost.dispose()

  // ---- 8: the process dies on its own (as a native crash would): only that request fails ----
  hb.phase = 'external SIGKILL (respawn + long request + kill)'
  const crash = await disturbWhileInferring(host, () => { process.kill(host.pid(), 'SIGKILL') })
  const crashOk = !crash.ok && crash.error instanceof SpeechProcessError && crash.error.code === 'DECODE_FAILED'
  criterion(8, 'speech process killed from outside mid-inference fails only that request (DECODE_FAILED), host alive', crashOk,
    `${crash.ms.toFixed(0)} ms; ${crashOk ? crash.error.message : `got ${crash.ok ? 'a result' : crash.error?.code + ' ' + crash.error?.message}`}`)

  // ---- 9: the same host recovers ----
  hb.phase = 'recovery request (respawn + load + transcribe)'
  const again = await host.transcribe(request(fixture)).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }))
  const againText = again.ok ? again.r.segments.map((s) => s.text).join(' ') : ''
  criterion(9, 'after 6-8 the same host transcribes the fixture again correctly (fresh process)', again.ok && wordErrorRate(REFERENCE, againText) <= 0.25,
    again.ok ? `WER ${(wordErrorRate(REFERENCE, againText) * 100).toFixed(1)} %, load ${again.r.loadMs} ms` : `${again.e?.code ?? ''} ${String(again.e?.message).slice(0, 200)}`)

  // ---- 4: the host stayed responsive through ALL of it ----
  criterion(4, 'host heartbeat gap <= 500 ms during the whole run (including every abort / kill)', hb.ticks > 20 && hb.maxGap <= 500, `max gap ${hb.maxGap.toFixed(0)} ms over ${hb.ticks} ticks${hb.slow.length ? `; gaps over 300 ms: ${hb.slow.join(', ')}` : ''}; blocking calls on the host thread: spawn max ${Math.max(...blocking.spawnMs).toFixed(0)} ms (n=${blocking.spawnMs.length}), kill max ${Math.max(0, ...blocking.killMs).toFixed(0)} ms, send max ${Math.max(0, ...blocking.sendMs).toFixed(0)} ms`)
} catch (error) {
  console.log(`  FAIL  unexpected error: ${error?.stack ?? error}`)
  results.push({ n: 0, name: 'unexpected error', ok: false })
} finally {
  clearInterval(timer)
  host?.dispose()
}

results.sort((a, b) => a.n - b.n)
const failed = results.filter((r) => !r.ok)
const onlyHeartbeat = failed.length > 0 && failed.every((r) => r.n === 4)
console.log(
  failed.length === 0
    ? `\nSMOKE TEST PASSED (${results.length}/${results.length})`
    : onlyHeartbeat
      ? '\nSMOKE TEST FAILED: 4 only — criterion 4 (host heartbeat <= 500 ms) is a documented NON-BLOCKING limitation (owner decision 2026-10-27, research R12); every correctness / abort / isolation criterion passed'
      : `\nSMOKE TEST FAILED: ${failed.map((r) => r.n || r.name).join(', ')} — stop; T015 and dependents must not start`,
)
process.exit(failed.length === 0 ? 0 : 1)
