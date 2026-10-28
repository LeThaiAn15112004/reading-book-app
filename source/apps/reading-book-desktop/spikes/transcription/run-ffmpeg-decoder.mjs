/**
 * The REAL bundled FFmpeg behind the transcription decoder (spec 004, T001a): the staged artifact, the real
 * `createAudioDecoder` (bundled from `electron/transcription/audio-decoder.ts`), real processes, real files.
 *
 *   A. artifact     resources/ffmpeg/<key>/ matches ffmpeg-artifacts.json; LGPL (-L), no GPL/nonfree/version3 flag;
 *                   Windows: imports only DLLs that ship with Windows and runs from a copy with PATH = System32 only
 *   B. decode       every format the app imports (audio.adapter.ts), via the app's own argv → 16 kHz mono f32le:
 *                   sample count of a whole window and of a window cut in the middle, and content (normalised
 *                   cross-correlation against the signal itself, rendered by this script — not by any FFmpeg)
 *   C. failures     damaged / non-audio / missing file, abort, path with spaces + Vietnamese + leading dash
 *   D. unavailable  no binary (NOT_BUNDLED), changed binary (INTEGRITY_FAILED), a binary Windows cannot load because a
 *                   DLL is missing (NOT_RUNNABLE) — none of them throws or crashes
 *
 * WAV variants are written by this script. The other formats need encoders the shipped binary does not have, so they
 * are made by a SEPARATE test-only FFmpeg (`scripts/ffmpeg/build-ffmpeg-windows.sh … fixture-tool`), given as
 *   READMATE_FFMPEG_FIXTURE_TOOL=<test-only ffmpeg>
 * MP3 has no LGPL encoder in FFmpeg: real files are checked with READMATE_FFMPEG_REAL_FILES=<file>;<file>… (sample
 * count from music-metadata's duration, non-silent output). READMATE_FFMPEG_DLL_DEPENDENT=<ffmpeg.exe that needs
 * libwinpthread-1.dll> enables the real missing-DLL case. Anything not given is reported as SKIPPED, never as passed.
 *
 * Run: npm run spike:transcription:ffmpeg
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isSystemDll, peImports } from '../../scripts/ffmpeg/pe-imports.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const desktop = path.resolve(here, '../..')
const key = `${process.platform}-${process.arch}`
const resourcesDir = path.join(desktop, 'resources')
const manifest = JSON.parse(fs.readFileSync(path.join(desktop, 'electron/transcription/ffmpeg-artifacts.json'), 'utf8'))
const artifact = manifest[key]
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-ffmpeg-spike-'))

// ---- the decoder under test, bundled from TypeScript (its SDK import is type-only) ----
const esbuild = require('esbuild')
const decoderBundle = path.join(work, 'audio-decoder.mjs')
await esbuild.build({
  entryPoints: [path.join(desktop, 'electron/transcription/audio-decoder.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: decoderBundle, logLevel: 'error',
  external: ['@reading-book/book-reader-sdk'],
})
const { createAudioDecoder, buildFfmpegArgs, DecodeError, DECODE_SAMPLE_RATE } = await import(pathToFileURL(decoderBundle).href)

let passed = 0
let failed = 0
const skipped = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  ✗ ${name}\n    ${error?.stack ?? error}`)
  }
}
const skip = (name, why) => {
  skipped.push(`${name} — ${why}`)
  console.log(`  - SKIPPED ${name} (${why})`)
}
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

if (!artifact) {
  console.log(`No artifact for ${key} in ffmpeg-artifacts.json — nothing to check on this machine.`)
  process.exit(1)
}
const exe = path.join(resourcesDir, 'ffmpeg', key, artifact.executable)
const SYSTEM32 = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') : '/usr/bin:/bin'

// =====================================================================================================================
console.log(`\nA. artifact ${key}`)
// =====================================================================================================================
await check('every manifest file is in resources/ffmpeg/<key>/ with its SHA-256; the LGPL text is beside it', () => {
  for (const file of artifact.files) assert.equal(sha256(path.join(resourcesDir, 'ffmpeg', key, file.name)), file.sha256, file.name)
  assert.ok(fs.existsSync(path.join(resourcesDir, 'ffmpeg', key, 'licenses', 'COPYING.LGPLv2.1')))
})
await check('licence: -L says LGPL v2.1 or later; -buildconf has no --enable-gpl / --enable-nonfree / --enable-version3', () => {
  const licence = spawnSync(exe, ['-hide_banner', '-L'], { encoding: 'utf8' })
  assert.equal(licence.status, 0)
  assert.match(licence.stdout, /GNU Lesser General Public\s+License[\s\S]*version 2\.1 of the License, or \(at your option\) any later version/)
  const conf = spawnSync(exe, ['-hide_banner', '-buildconf'], { encoding: 'utf8' })
  assert.equal(conf.status, 0)
  for (const flag of ['--enable-gpl', '--enable-nonfree', '--enable-version3']) assert.ok(!conf.stdout.includes(flag), flag)
  assert.ok(conf.stdout.includes('--enable-muxer=pcm_f32le'))
})
if (process.platform === 'win32') {
  await check('Windows: imports only DLLs that ship with Windows (no libwinpthread-1.dll / libgcc)', () => {
    const imports = peImports(exe)
    assert.deepEqual(imports.filter((dll) => !isSystemDll(dll)), [], imports.join(', '))
  })
  await check('Windows: a copy in an empty folder runs with PATH = System32 only (no MSYS2, no Git, no app folder)', () => {
    const lonely = path.join(work, 'lonely')
    fs.mkdirSync(lonely)
    fs.copyFileSync(exe, path.join(lonely, 'ffmpeg.exe'))
    const run = spawnSync(path.join(lonely, 'ffmpeg.exe'), ['-hide_banner', '-version'], { encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, PATH: SYSTEM32 } })
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /^ffmpeg version /)
  })
}
const decoder = createAudioDecoder({ resourcesDir })
await check('availability(): hash gate + self-test pass; the executable is ours, under resources/', async () => {
  assert.deepEqual(await decoder.availability(), { available: true, executablePath: exe })
})

// =====================================================================================================================
console.log('\nB. decode → 16 kHz mono float32 (the app argv)')
// =====================================================================================================================
// A band-limited, speech-like test signal: syllable-rate AM over a few partials plus a slow chirp. Analytic, so the
// reference at 16 kHz is computed here, independently of every FFmpeg decoder and resampler.
const SECONDS = 20
const signal = (t) => {
  const envelope = 0.55 + 0.45 * Math.sin(2 * Math.PI * 3.7 * t) * Math.sin(2 * Math.PI * 0.31 * t + 1)
  const f0 = 140 + 40 * Math.sin(2 * Math.PI * 0.2 * t)
  const chirp = Math.sin(2 * Math.PI * (300 * t + 45 * t * t))
  return 0.4 * envelope * (0.5 * Math.sin(2 * Math.PI * f0 * t) + 0.3 * Math.sin(2 * Math.PI * 2.5 * f0 * t + 0.4) + 0.2 * chirp)
}
const reference = Float32Array.from({ length: SECONDS * DECODE_SAMPLE_RATE }, (_, i) => signal(i / DECODE_SAMPLE_RATE))

/** RIFF/WAVE, both channels the same signal. `kind`: u8 | s16 | s24 | s32 | f32 | f64. */
function writeWav(file, kind, rate = 44_100, channels = 2) {
  const bits = { u8: 8, s16: 16, s24: 24, s32: 32, f32: 32, f64: 64 }[kind]
  const float = kind === 'f32' || kind === 'f64'
  const frames = SECONDS * rate
  const bytes = bits / 8
  const data = Buffer.alloc(frames * channels * bytes)
  for (let i = 0; i < frames; i += 1) {
    const v = signal(i / rate)
    for (let c = 0; c < channels; c += 1) {
      const o = (i * channels + c) * bytes
      if (kind === 'u8') data.writeUInt8(Math.round(128 + v * 127), o)
      else if (kind === 's16') data.writeInt16LE(Math.round(v * 32767), o)
      else if (kind === 's24') data.writeIntLE(Math.round(v * 8388607), o, 3)
      else if (kind === 's32') data.writeInt32LE(Math.round(v * 2147483647), o)
      else if (kind === 'f32') data.writeFloatLE(v, o)
      else data.writeDoubleLE(v, o)
    }
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8)
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(float ? 3 : 1, 20); head.writeUInt16LE(channels, 22)
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * channels * bytes, 28); head.writeUInt16LE(channels * bytes, 32); head.writeUInt16LE(bits, 34)
  head.write('data', 36); head.writeUInt32LE(data.length, 40)
  fs.writeFileSync(file, Buffer.concat([head, data]))
}

/** Best normalised cross-correlation of `actual` against `reference` starting at `refStart`, over lags ±maxLag. */
function bestCorrelation(actual, refStart, maxLag = 2400) {
  const n = Math.min(actual.length - 2 * maxLag, DECODE_SAMPLE_RATE)
  assert.ok(n > DECODE_SAMPLE_RATE / 2, `too little audio to compare (${actual.length} samples)`)
  const a = actual.subarray(maxLag, maxLag + n)
  let aa = 0
  for (const x of a) aa += x * x
  let best = { r: -1, lagMs: 0 }
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const s = refStart + maxLag + lag
    if (s < 0 || s + n > reference.length) continue
    let ab = 0
    let bb = 0
    for (let i = 0; i < n; i += 1) {
      const b = reference[s + i]
      ab += a[i] * b
      bb += b * b
    }
    const r = ab / Math.sqrt(aa * bb)
    if (r > best.r) best = { r, lagMs: (-lag * 1000) / DECODE_SAMPLE_RATE }
  }
  return best
}

const fixtures = path.join(work, 'fixtures')
fs.mkdirSync(fixtures)
const formats = [] // { name, file, lossless }
for (const kind of ['u8', 's16', 's24', 's32', 'f32', 'f64']) {
  const file = path.join(fixtures, `wav-${kind}.wav`)
  writeWav(file, kind)
  formats.push({ name: `WAV ${kind === 'f32' || kind === 'f64' ? 'IEEE float' : 'PCM'} ${kind}, 44.1 kHz stereo`, file, lossless: kind !== 'u8' })
}
const tool = process.env.READMATE_FFMPEG_FIXTURE_TOOL
if (tool) {
  const master = path.join(fixtures, 'master-s16.wav')
  writeWav(master, 's16')
  const encode = [
    ['FLAC', 'flac.flac', ['-c:a', 'flac'], true],
    ['M4A (AAC-LC)', 'aac.m4a', ['-c:a', 'aac', '-b:a', '96k', '-f', 'ipod'], false],
    ['M4B (AAC-LC)', 'aac.m4b', ['-c:a', 'aac', '-b:a', '64k', '-f', 'ipod'], false],
    ['AAC (ADTS)', 'adts.aac', ['-c:a', 'aac', '-b:a', '96k', '-f', 'adts'], false],
    ['Ogg Vorbis', 'vorbis.ogg', ['-c:a', 'vorbis', '-strict', '-2', '-q:a', '5'], false],
    ['Ogg Opus (.ogg)', 'opus.ogg', ['-c:a', 'opus', '-strict', '-2', '-ar', '48000', '-b:a', '64k', '-f', 'ogg'], false],
    ['Opus (.opus)', 'opus.opus', ['-c:a', 'opus', '-strict', '-2', '-ar', '48000', '-b:a', '64k', '-f', 'opus'], false],
  ]
  for (const [name, out, args, lossless] of encode) {
    const file = path.join(fixtures, out)
    const run = spawnSync(tool, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', master, ...args, file], { encoding: 'utf8' })
    if (run.status !== 0) {
      failed += 1
      console.log(`  ✗ fixture ${name} could not be made by the test-only tool: ${run.stderr.trim()}`)
      continue
    }
    formats.push({ name, file, lossless })
  }
} else {
  skip('FLAC / M4A / M4B / AAC (ADTS) / Ogg Vorbis / Opus fixtures', 'READMATE_FFMPEG_FIXTURE_TOOL not set')
}

const results = []
for (const { name, file, lossless } of formats) {
  await check(`${name}: whole window and a window cut in the middle decode to the right length and content`, async () => {
    const whole = await decoder.decodeWindow({ filePath: file, startMs: 0, lengthMs: 10_000 })
    const middle = await decoder.decodeWindow({ filePath: file, startMs: 7_250, lengthMs: 3_500 })
    const tail = await decoder.decodeWindow({ filePath: file, startMs: (SECONDS - 2) * 1000, lengthMs: 30_000 })
    const past = await decoder.decodeWindow({ filePath: file, startMs: (SECONDS + 5) * 1000, lengthMs: 30_000 })
    const cWhole = bestCorrelation(whole, 0)
    const cMiddle = bestCorrelation(middle, 7_250 * 16)
    results.push({ name, wholeSamples: whole.length, middleSamples: middle.length, tailSamples: tail.length, rWhole: cWhole.r, lagWholeMs: cWhole.lagMs, rMiddle: cMiddle.r, lagMiddleMs: cMiddle.lagMs })
    const slack = 0.05 * DECODE_SAMPLE_RATE // 50 ms: codec priming / resampler edge
    assert.ok(Math.abs(whole.length - 160_000) <= slack, `whole window: ${whole.length} samples, expected 160000`)
    assert.ok(Math.abs(middle.length - 56_000) <= slack, `middle window: ${middle.length} samples, expected 56000`)
    assert.ok(Math.abs(tail.length - 32_000) <= slack, `last 2 s: ${tail.length} samples, expected 32000 (window past the end is cut)`)
    assert.equal(past.length, 0, 'a window after the end is empty')
    const minR = lossless ? 0.999 : 0.95
    assert.ok(cWhole.r >= minR, `whole: correlation ${cWhole.r.toFixed(4)} < ${minR}`)
    assert.ok(cMiddle.r >= minR, `middle: correlation ${cMiddle.r.toFixed(4)} < ${minR}`)
    assert.ok(Math.abs(cMiddle.lagMs) <= 100, `the middle window starts ${cMiddle.lagMs} ms off`)
    for (const x of whole) assert.ok(Number.isFinite(x) && Math.abs(x) <= 1.5)
  })
}
const realFiles = (process.env.READMATE_FFMPEG_REAL_FILES ?? '').split(';').filter(Boolean)
if (realFiles.length) {
  const { parseFile } = await import('music-metadata')
  for (const file of realFiles) {
    await check(`real file ${path.basename(file)}: two windows decode to the expected length, not silence`, async () => {
      const seconds = (await parseFile(file, { duration: true })).format.duration
      assert.ok(seconds > 40, `need a file longer than 40 s (${seconds})`)
      const start = Math.floor((seconds / 2) * 1000)
      for (const startMs of [0, start]) {
        const pcm = await decoder.decodeWindow({ filePath: file, startMs, lengthMs: 30_000 })
        let energy = 0
        for (const x of pcm) energy += x * x
        const rms = Math.sqrt(energy / pcm.length)
        results.push({ name: `${path.basename(file)} @${(startMs / 1000).toFixed(0)}s`, wholeSamples: pcm.length, rms })
        assert.ok(Math.abs(pcm.length - 480_000) <= 0.05 * DECODE_SAMPLE_RATE, `${pcm.length} samples, expected 480000`)
        assert.ok(rms > 0.003, `RMS ${rms} — silence`)
      }
    })
  }
} else {
  skip('real MP3 / M4B files', 'READMATE_FFMPEG_REAL_FILES not set (MP3 has no LGPL encoder to make a fixture)')
}
console.table(results.map((r) => ({ ...r, rWhole: r.rWhole?.toFixed(5), rMiddle: r.rMiddle?.toFixed(5), rms: r.rms?.toFixed(4) })))

// =====================================================================================================================
console.log('\nC. failures with the real binary')
// =====================================================================================================================
await check('a damaged file and a text file renamed .wav fail DECODE_FAILED with FFmpeg\'s own reason, never hang', async () => {
  const junk = path.join(fixtures, 'junk.mp3')
  fs.writeFileSync(junk, Buffer.from(Array.from({ length: 50_000 }, (_, i) => (i * 7919) % 251)))
  const text = path.join(fixtures, 'notes.wav')
  fs.writeFileSync(text, 'this is not audio\n'.repeat(500))
  for (const file of [junk, text]) {
    await assert.rejects(decoder.decodeWindow({ filePath: file, startMs: 0, lengthMs: 30_000 }), (e) => e instanceof DecodeError && e.code === 'DECODE_FAILED' && /Decoder exited with \d+: \S/.test(e.message))
  }
})
await check('a missing file is FILE_MISSING (nothing spawned)', async () => {
  await assert.rejects(decoder.decodeWindow({ filePath: path.join(fixtures, 'gone.mp3'), startMs: 0, lengthMs: 1000 }), (e) => e.code === 'FILE_MISSING')
})
await check('abort during a decode ends ABORTED promptly', async () => {
  const long = path.join(fixtures, 'wav-f64.wav')
  for (const delay of [0, 5]) {
    const ctl = new AbortController()
    const started = Date.now()
    const pending = decoder.decodeWindow({ filePath: long, startMs: 0, lengthMs: 20_000, signal: ctl.signal })
    setTimeout(() => ctl.abort(), delay)
    await assert.rejects(pending, (e) => e.code === 'ABORTED')
    assert.ok(Date.now() - started < 2000)
  }
})
await check('a path with spaces, Vietnamese letters and a leading dash is one argument and decodes', async () => {
  const folder = path.join(fixtures, 'Sách nói của tôi')
  fs.mkdirSync(folder)
  const odd = path.join(folder, "-Chương 1 (bản 'thử').wav")
  fs.copyFileSync(path.join(fixtures, 'wav-s16.wav'), odd)
  assert.equal(buildFfmpegArgs(odd, 0, 1000).filter((a) => a === odd).length, 1)
  const pcm = await decoder.decodeWindow({ filePath: odd, startMs: 1000, lengthMs: 2000 })
  assert.ok(Math.abs(pcm.length - 32_000) <= 800)
})

// =====================================================================================================================
console.log('\nD. decoder unavailable — reported, never a crash')
// =====================================================================================================================
await check('no binary in the resources folder → NOT_BUNDLED; decodeWindow rejects DECODE_FAILED', async () => {
  const empty = path.join(work, 'empty-resources')
  fs.mkdirSync(empty)
  const d = createAudioDecoder({ resourcesDir: empty })
  assert.deepEqual(await d.availability(), { available: false, reason: 'NOT_BUNDLED', detail: `${key}: ${artifact.executable} is missing` })
  await assert.rejects(d.decodeWindow({ filePath: path.join(fixtures, 'wav-s16.wav'), startMs: 0, lengthMs: 1000 }), (e) => e.code === 'DECODE_FAILED')
})
await check('a changed binary → INTEGRITY_FAILED, never run', async () => {
  const changed = path.join(work, 'changed-resources', 'ffmpeg', key)
  fs.mkdirSync(changed, { recursive: true })
  fs.writeFileSync(path.join(changed, artifact.executable), Buffer.concat([fs.readFileSync(exe), Buffer.from([0])]))
  const a = await createAudioDecoder({ resourcesDir: path.join(work, 'changed-resources') }).availability()
  assert.equal(a.reason, 'INTEGRITY_FAILED'); assert.match(a.detail, /SHA-256 mismatch/)
})
const dllDependent = process.env.READMATE_FFMPEG_DLL_DEPENDENT
if (process.platform === 'win32' && dllDependent) {
  await check('a verified binary that Windows cannot load (libwinpthread-1.dll missing) → NOT_RUNNABLE with the reason in words', async () => {
    const folder = path.join(work, 'dll-resources', 'ffmpeg', key)
    fs.mkdirSync(folder, { recursive: true })
    fs.copyFileSync(dllDependent, path.join(folder, 'ffmpeg.exe'))
    const artifacts = { [key]: { executable: 'ffmpeg.exe', files: [{ name: 'ffmpeg.exe', sha256: sha256(dllDependent) }] } }
    const savedPath = process.env.PATH
    process.env.PATH = SYSTEM32 // the spawned process inherits this: no MSYS2 / Git folder that happens to hold the DLL
    try {
      const a = await createAudioDecoder({ resourcesDir: path.join(work, 'dll-resources'), artifacts }).availability()
      assert.equal(a.available, false); assert.equal(a.reason, 'NOT_RUNNABLE')
      assert.match(a.detail, /required DLL was not found \(exit 0xc0000135\)/)
    } finally {
      process.env.PATH = savedPath
    }
  })
} else {
  skip('real missing-DLL case', 'READMATE_FFMPEG_DLL_DEPENDENT not set (or not Windows)')
}

fs.rmSync(work, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed, ${skipped.length} skipped`)
for (const line of skipped) console.log(`  skipped: ${line}`)
process.exit(failed ? 1 : 0)
