import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { TranscriptionErrorCode } from '@reading-book/book-reader-sdk'
import {
  TRANSCRIPTION_MODELS,
  modelFileUrl,
  type TranscriptionModelFile,
  type TranscriptionModelSpec,
} from './transcription-models'

/**
 * Speech-model storage for audiobook transcription (spec 004, research R5, task T013).
 *
 * - Models live in `{modelsDir}/<id>/` with the repository's own relative paths (`onnx/…`), which is the layout
 *   transformers.js reads when it is pointed at a local model folder.
 * - A download happens ONLY when `download()` is called; callers must have the user's consent first (nothing here
 *   ever starts one by itself, and nothing is bundled with the app).
 * - Only the manifest's pinned revision is fetched, file by file, into a `.partial-*` folder. Every file's size and
 *   SHA-256 must match the catalog before anything is moved into place; on any mismatch (or error, or abort) the
 *   partial folder is deleted, nothing is installed and the error is `INTEGRITY_FAILED` (or the matching code).
 * - `verifyInstalled()` re-hashes an installed model; a failure means "not installed" for the loader.
 *
 * Must not import `electron`: the folder is passed in by the caller (`{userData}/transcription-models`).
 *
 * Error codes (contract `TranscriptionErrorCode`): `MODEL_MISSING` also covers a download that could not be
 * completed (network/HTTP failure) — the model is still missing; the message says why.
 */

export type ModelErrorCode = Extract<
  TranscriptionErrorCode,
  'MODEL_MISSING' | 'DISK_FULL' | 'INTEGRITY_FAILED' | 'ABORTED' | 'INVALID_ARGUMENT'
>

export class ModelError extends Error {
  constructor(
    readonly code: ModelErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ModelError'
  }
}

export interface ModelDownloadProgress {
  modelId: string
  loadedBytes: number
  totalBytes: number
}

export interface ModelInfo {
  id: string
  label: string
  sizeBytes: number
  installed: boolean
}

export type ModelVerification = { ok: true } | { ok: false; file: string; reason: 'missing' | 'size' | 'sha256' }

export interface ModelManagerOptions {
  /** `{userData}/transcription-models` — created on first download. */
  modelsDir: string
  /** Defaults to the verified catalog; tests inject a tiny one. */
  catalog?: readonly TranscriptionModelSpec[]
  /** Test seam; defaults to the global `fetch`. */
  fetchFile?: typeof fetch
  /** Test seam; defaults to `fs.statfs` on the models folder (available bytes). */
  freeBytes?: (dir: string) => Promise<number>
  /** Test seam; defaults to the Hugging Face URL of the pinned revision. */
  urlFor?: (spec: TranscriptionModelSpec, file: TranscriptionModelFile) => string
}

/** Headroom on top of the model size for the partial copy and file-system overhead. */
const DISK_HEADROOM = 1.1
const PROGRESS_INTERVAL_MS = 120

async function defaultFreeBytes(dir: string): Promise<number> {
  const stats = await fs.promises.statfs(dir)
  return Number(stats.bavail) * Number(stats.bsize)
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export function createModelManager(options: ModelManagerOptions) {
  const catalog = options.catalog ?? TRANSCRIPTION_MODELS
  const fetchFile = options.fetchFile ?? ((input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, init))
  const freeBytes = options.freeBytes ?? defaultFreeBytes
  const urlFor = options.urlFor ?? modelFileUrl
  const inflight = new Map<string, Promise<void>>()

  function spec(id: string): TranscriptionModelSpec {
    const found = catalog.find((model) => model.id === id)
    if (!found) throw new ModelError('INVALID_ARGUMENT', `Unknown speech model "${id}"`)
    return found
  }

  const modelDir = (id: string): string => path.join(options.modelsDir, spec(id).id)
  const fileInside = (dir: string, relative: string): string => path.join(dir, ...relative.split('/'))

  /** Cheap check (existence + size of every file); NOT a proof of integrity — see `verifyInstalled`. */
  async function isInstalled(id: string): Promise<boolean> {
    const model = spec(id)
    const dir = modelDir(id)
    for (const file of model.files) {
      try {
        const stat = await fs.promises.stat(fileInside(dir, file.path))
        if (!stat.isFile() || stat.size !== file.bytes) return false
      } catch {
        return false
      }
    }
    return true
  }

  /** Re-hash every file against the catalog. Not installed → `ok: false` naming the first bad file. */
  async function verifyInstalled(id: string): Promise<ModelVerification> {
    const model = spec(id)
    const dir = modelDir(id)
    for (const file of model.files) {
      const target = fileInside(dir, file.path)
      let size: number
      try {
        size = (await fs.promises.stat(target)).size
      } catch {
        return { ok: false, file: file.path, reason: 'missing' }
      }
      if (size !== file.bytes) return { ok: false, file: file.path, reason: 'size' }
      if ((await sha256OfFile(target)) !== file.sha256) return { ok: false, file: file.path, reason: 'sha256' }
    }
    return { ok: true }
  }

  async function list(): Promise<ModelInfo[]> {
    const infos: ModelInfo[] = []
    for (const model of catalog) {
      infos.push({ id: model.id, label: model.label, sizeBytes: model.totalBytes, installed: await isInstalled(model.id) })
    }
    return infos
  }

  async function removePartial(dir: string): Promise<void> {
    await fs.promises.rm(dir, { recursive: true, force: true })
  }

  async function downloadFile(
    model: TranscriptionModelSpec,
    file: TranscriptionModelFile,
    target: string,
    signal: AbortSignal | undefined,
    onBytes: (n: number) => void,
  ): Promise<void> {
    let response: Response
    try {
      response = await fetchFile(urlFor(model, file), { signal, redirect: 'follow' })
    } catch (error) {
      if (signal?.aborted) throw new ModelError('ABORTED', 'Model download cancelled')
      throw new ModelError('MODEL_MISSING', `Could not download ${file.path}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok || !response.body) {
      throw new ModelError('MODEL_MISSING', `Could not download ${file.path}: HTTP ${response.status}`)
    }

    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    const hash = createHash('sha256')
    let received = 0
    const guard = new Transform({
      transform(chunk: Buffer, _encoding, callback: TransformCallback) {
        received += chunk.length
        if (received > file.bytes) {
          callback(new ModelError('INTEGRITY_FAILED', `${file.path} is larger than expected`))
          return
        }
        hash.update(chunk)
        onBytes(chunk.length)
        callback(null, chunk)
      },
    })
    try {
      await pipeline(Readable.fromWeb(response.body as never), guard, fs.createWriteStream(target), { signal })
    } catch (error) {
      if (error instanceof ModelError) throw error
      if (signal?.aborted) throw new ModelError('ABORTED', 'Model download cancelled')
      throw new ModelError('MODEL_MISSING', `Could not download ${file.path}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (received !== file.bytes) throw new ModelError('INTEGRITY_FAILED', `${file.path} has ${received} bytes, expected ${file.bytes}`)
    if (hash.digest('hex') !== file.sha256) throw new ModelError('INTEGRITY_FAILED', `${file.path} does not match its pinned SHA-256`)
  }

  async function runDownload(
    model: TranscriptionModelSpec,
    signal: AbortSignal | undefined,
    onProgress: ((progress: ModelDownloadProgress) => void) | undefined,
  ): Promise<void> {
    const finalDir = modelDir(model.id)
    if ((await isInstalled(model.id)) && (await verifyInstalled(model.id)).ok) return

    await fs.promises.mkdir(options.modelsDir, { recursive: true })
    const needed = Math.ceil(model.totalBytes * DISK_HEADROOM)
    const available = await freeBytes(options.modelsDir)
    if (available < needed) {
      throw new ModelError('DISK_FULL', `Not enough free disk space: ${needed} bytes needed, ${available} available`)
    }

    const partial = path.join(options.modelsDir, `.partial-${model.id}-${randomUUID()}`)
    let loaded = 0
    let lastReport = 0
    const report = (force: boolean): void => {
      const now = Date.now()
      if (!force && now - lastReport < PROGRESS_INTERVAL_MS) return
      lastReport = now
      onProgress?.({ modelId: model.id, loadedBytes: loaded, totalBytes: model.totalBytes })
    }
    try {
      report(true)
      for (const file of model.files) {
        if (signal?.aborted) throw new ModelError('ABORTED', 'Model download cancelled')
        await downloadFile(model, file, fileInside(partial, file.path), signal, (n) => {
          loaded += n
          report(false)
        })
      }
      report(true)
      // Move into place only after EVERY file was verified. A previous (tampered or incomplete) copy is replaced.
      const trash = `${partial}.old`
      let hadOld = false
      try {
        await fs.promises.rename(finalDir, trash)
        hadOld = true
      } catch {
        /* nothing there */
      }
      try {
        await fs.promises.rename(partial, finalDir)
      } catch (error) {
        if (hadOld) await fs.promises.rename(trash, finalDir).catch(() => undefined)
        throw error
      }
      if (hadOld) await removePartial(trash)
    } catch (error) {
      await removePartial(partial)
      throw error
    }
  }

  /**
   * Download (or confirm) one model. Call only after the user has agreed. Resolves when the model is installed
   * and verified; rejects with a `ModelError`. One download per model at a time (a second call joins the first).
   */
  async function download(
    id: string,
    downloadOptions: { signal?: AbortSignal; onProgress?: (progress: ModelDownloadProgress) => void } = {},
  ): Promise<void> {
    const model = spec(id)
    const running = inflight.get(model.id)
    if (running) return running
    const task = runDownload(model, downloadOptions.signal, downloadOptions.onProgress).finally(() => inflight.delete(model.id))
    inflight.set(model.id, task)
    return task
  }

  async function remove(id: string): Promise<void> {
    await fs.promises.rm(modelDir(id), { recursive: true, force: true })
  }

  return { list, isInstalled, verifyInstalled, download, remove, modelDir, catalog }
}

export type ModelManager = ReturnType<typeof createModelManager>
