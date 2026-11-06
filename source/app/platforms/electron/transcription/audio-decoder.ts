import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { TranscriptionErrorCode } from '@reading-book/book-reader-sdk'
import {
  FFMPEG_ARTIFACTS,
  ffmpegArtifactKey,
  isUsableArtifact,
  type FfmpegArtifact,
  type FfmpegArtifactKey,
} from './ffmpeg-artifacts'

/**
 * Audio → 16 kHz mono float32 PCM, one time window at a time (spec 004, research R2).
 *
 * Runs OUR OWN minimal LGPL FFmpeg as a separate process, located under `{resourcesDir}/ffmpeg/<platform>-<arch>/`
 * — never an `ffmpeg` on `PATH`, never the `ffmpeg-static` package. Before the first spawn every file of the
 * artifact is hashed and compared with `FFMPEG_ARTIFACTS`, then the binary is started once with a harmless query
 * (`-h muxer=f32le`) so that a binary Windows cannot load (missing DLL, blocked by security software) is reported
 * before anyone downloads a speech model; the verdict is cached. No verified artifact for this platform (Linux,
 * macOS until a Mac build exists) → the decoder is unavailable and nothing is spawned.
 *
 * The argv below was checked against the real win32-x64 build (`spike:transcription:ffmpeg`).
 *
 * Must not import `electron`: `resourcesDir` is passed in by the caller.
 */

export const DECODE_SAMPLE_RATE = 16_000
const BYTES_PER_SAMPLE = 4
/** Hard stop for a stuck decode; a 30 s window decodes in well under a second. */
const DEFAULT_TIMEOUT_MS = 120_000
/** Allowed overshoot over the expected PCM size before the process is killed (resampler padding). */
const OVERSHOOT_SECONDS = 2
const STDERR_LIMIT = 4096
/** The self-test only prints a few lines of help text. */
const SELF_TEST_TIMEOUT_MS = 15_000

/**
 * `NOT_BUNDLED`: no verified artifact for this platform, or its files are missing from the installation.
 * `NOT_RUNNABLE`: the files are intact but the binary does not start or lacks the `f32le` output (missing DLL, blocked).
 */
export type DecoderUnavailableReason = 'UNSUPPORTED_PLATFORM' | 'NOT_BUNDLED' | 'INTEGRITY_FAILED' | 'NOT_RUNNABLE'

export type DecoderAvailability =
  | { available: true; executablePath: string }
  | { available: false; reason: DecoderUnavailableReason; detail?: string }

export class DecodeError extends Error {
  constructor(
    readonly code: Extract<TranscriptionErrorCode, 'DECODE_FAILED' | 'FILE_MISSING' | 'ABORTED' | 'INTEGRITY_FAILED'>,
    message: string,
  ) {
    super(message)
    this.name = 'DecodeError'
  }
}

export interface DecodeWindowRequest {
  /** A path already validated by the caller (`resolveBookFile` / `audio-lookup`); never taken from the renderer. */
  filePath: string
  startMs: number
  lengthMs: number
  signal?: AbortSignal
}

export interface AudioDecoder {
  availability(): Promise<DecoderAvailability>
  /** Float32 mono samples at 16 kHz; empty when the window starts at or past the end of the audio. */
  decodeWindow(request: DecodeWindowRequest): Promise<Float32Array>
}

export interface AudioDecoderOptions {
  /** `process.resourcesPath` when packaged, the build output folder in development. */
  resourcesDir: string
  platform?: string
  arch?: string
  /** Defaults to `FFMPEG_ARTIFACTS` (empty until a verified build exists). */
  artifacts?: Readonly<Partial<Record<FfmpegArtifactKey, FfmpegArtifact>>>
  timeoutMs?: number
  /** Test seam; defaults to `child_process.spawn`. */
  spawnProcess?: typeof spawn
  /** Test seam; defaults to a streaming SHA-256 of the file. */
  hashFile?: (filePath: string) => Promise<string>
}

/** Seconds with millisecond precision, e.g. `12.345`; never exponent notation. */
function seconds(ms: number): string {
  return (ms / 1000).toFixed(3)
}

/**
 * The argument vector (no shell, the file path is one argument after `-i`). `-ss` before `-i` seeks the input;
 * `-t` bounds the output; first audio stream only; mono 16 kHz raw little-endian float32 on stdout.
 */
export function buildFfmpegArgs(filePath: string, startMs: number, lengthMs: number): string[] {
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-protocol_whitelist',
    'file',
    '-ss',
    seconds(startMs),
    '-t',
    seconds(lengthMs),
    '-i',
    filePath,
    '-vn',
    '-sn',
    '-dn',
    '-map',
    '0:a:0',
    '-ac',
    '1',
    '-ar',
    String(DECODE_SAMPLE_RATE),
    '-f',
    'f32le',
    'pipe:1',
  ]
}

/** Prints the help of the one muxer the decoder needs; exits 0 and names it only when the binary really has it. */
export const SELF_TEST_ARGS: readonly string[] = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-h', 'muxer=f32le']

/** Windows NTSTATUS exit codes of a process that could not even start, in words. */
const WINDOWS_LOAD_FAILURES: Readonly<Record<number, string>> = {
  0xc0000135: 'a required DLL was not found',
  0xc0000139: 'a required DLL entry point was not found',
  0xc000007b: 'the executable or one of its DLLs is not a valid image for this system',
  0xc0000142: 'a DLL failed to initialise',
}

function describeExit(code: number | null): string {
  if (code === null) return 'it was stopped by a signal'
  const reason = WINDOWS_LOAD_FAILURES[code >>> 0]
  return reason ? `${reason} (exit 0x${(code >>> 0).toString(16)})` : `exit code ${code}`
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve())
  })
  return hash.digest('hex')
}

export function createAudioDecoder(options: AudioDecoderOptions): AudioDecoder {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const artifacts = options.artifacts ?? FFMPEG_ARTIFACTS
  const spawnProcess = options.spawnProcess ?? spawn
  const hashFile = options.hashFile ?? sha256OfFile
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let verdict: Promise<DecoderAvailability> | null = null

  async function verify(): Promise<DecoderAvailability> {
    const key = ffmpegArtifactKey(platform, arch)
    if (!key) return { available: false, reason: 'UNSUPPORTED_PLATFORM', detail: `${platform}-${arch}` }
    const artifact = artifacts[key]
    if (!artifact || !isUsableArtifact(artifact)) {
      return { available: false, reason: 'NOT_BUNDLED', detail: key }
    }
    const folder = path.join(options.resourcesDir, 'ffmpeg', key)
    for (const file of artifact.files) {
      const target = path.join(folder, ...file.name.split('/'))
      let actual: string
      try {
        actual = await hashFile(target)
      } catch (error) {
        // Not installed (or removed afterwards, e.g. quarantined by antivirus) is a different fault from a changed file.
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          return { available: false, reason: 'NOT_BUNDLED', detail: `${key}: ${file.name} is missing` }
        }
        return { available: false, reason: 'INTEGRITY_FAILED', detail: `${file.name}: unreadable` }
      }
      if (actual.toLowerCase() !== file.sha256) {
        return { available: false, reason: 'INTEGRITY_FAILED', detail: `${file.name}: SHA-256 mismatch` }
      }
    }
    const executablePath = path.join(folder, ...artifact.executable.split('/'))
    const failure = await selfTest(executablePath)
    if (failure) return { available: false, reason: 'NOT_RUNNABLE', detail: failure }
    return { available: true, executablePath }
  }

  /** null when the verified binary starts and can write `f32le`; otherwise why not, in words. */
  function selfTest(executablePath: string): Promise<string | null> {
    return new Promise((resolve) => {
      let child: ChildProcess
      try {
        child = spawnProcess(executablePath, [...SELF_TEST_ARGS], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false })
      } catch (error) {
        resolve(`it could not be started: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      let output = ''
      let settled = false
      const done = (result: string | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => {
        done('it did not answer in time')
        child.kill('SIGKILL')
      }, Math.min(timeoutMs, SELF_TEST_TIMEOUT_MS))
      const collect = (chunk: Buffer): void => {
        if (output.length < STDERR_LIMIT) output += chunk.toString('utf8').slice(0, STDERR_LIMIT - output.length)
      }
      child.stdout?.on('data', collect)
      child.stderr?.on('data', collect)
      child.on('error', (error: Error) => done(`it could not be started: ${error.message}`))
      child.on('close', (code: number | null) => {
        if (code !== 0) done(`it could not run: ${describeExit(code)}`)
        else if (!/Muxer f32le\b/.test(output)) done('it cannot write raw float PCM (f32le)')
        else done(null)
      })
    })
  }

  const availability = (): Promise<DecoderAvailability> => (verdict ??= verify())

  async function decodeWindow(request: DecodeWindowRequest): Promise<Float32Array> {
    const { filePath, startMs, lengthMs, signal } = request
    if (!Number.isFinite(startMs) || !Number.isFinite(lengthMs) || startMs < 0 || lengthMs <= 0) {
      throw new DecodeError('DECODE_FAILED', 'Invalid decode window')
    }
    if (signal?.aborted) throw new DecodeError('ABORTED', 'Decode aborted')

    const state = await availability()
    if (!state.available) {
      throw new DecodeError(
        state.reason === 'INTEGRITY_FAILED' ? 'INTEGRITY_FAILED' : 'DECODE_FAILED',
        `Audio decoder unavailable (${state.reason}${state.detail ? `: ${state.detail}` : ''})`,
      )
    }
    try {
      await fs.promises.access(filePath, fs.constants.R_OK)
    } catch {
      throw new DecodeError('FILE_MISSING', 'Audio file is missing or unreadable')
    }
    // An abort during the awaits above would never reach the listener added below (it is added after the event).
    if (signal?.aborted) throw new DecodeError('ABORTED', 'Decode aborted')

    const expectedBytes = Math.ceil((lengthMs / 1000) * DECODE_SAMPLE_RATE) * BYTES_PER_SAMPLE
    const maxBytes = expectedBytes + OVERSHOOT_SECONDS * DECODE_SAMPLE_RATE * BYTES_PER_SAMPLE

    return new Promise<Float32Array>((resolve, reject) => {
      const child: ChildProcess = spawnProcess(state.executablePath, buildFfmpegArgs(filePath, startMs, lengthMs), {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      })
      const chunks: Buffer[] = []
      let received = 0
      let stderr = ''
      let settled = false

      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        fn()
      }
      const stop = (error: DecodeError): void => {
        finish(() => reject(error))
        child.kill('SIGKILL')
      }
      const onAbort = (): void => stop(new DecodeError('ABORTED', 'Decode aborted'))
      const timer = setTimeout(() => stop(new DecodeError('DECODE_FAILED', 'Decoder timed out')), timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })

      child.stdout?.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received > maxBytes) {
          stop(new DecodeError('DECODE_FAILED', 'Decoder produced more audio than requested'))
          return
        }
        chunks.push(chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < STDERR_LIMIT) stderr += chunk.toString('utf8').slice(0, STDERR_LIMIT - stderr.length)
      })
      child.on('error', (error: Error) =>
        finish(() => reject(new DecodeError('DECODE_FAILED', `Could not start the decoder: ${error.message}`))),
      )
      child.on('close', (code: number | null) => {
        if (code !== 0) {
          finish(() =>
            reject(new DecodeError('DECODE_FAILED', `Decoder exited with ${code ?? 'a signal'}: ${stderr.trim()}`)),
          )
          return
        }
        finish(() => {
          const all = Buffer.concat(chunks)
          const whole = all.length - (all.length % BYTES_PER_SAMPLE)
          const samples = new Float32Array(whole / BYTES_PER_SAMPLE)
          for (let i = 0; i < samples.length; i += 1) samples[i] = all.readFloatLE(i * BYTES_PER_SAMPLE)
          resolve(samples)
        })
      })
    })
  }

  return { availability, decodeWindow }
}
