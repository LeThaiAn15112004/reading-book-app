/**
 * Write a file attachment into a PDF (specs/007-pdf-file-attachment research R3–R6): stage the picked file,
 * stream its content (deflated) into ONE incremental update planned by `planAttachmentAppend`, verify the temp
 * file and only then replace the PDF. The content is never held in memory here; the PDF itself is (as for every
 * other annotation write). Pure Node — no Electron, no SQLite; also driven by the spikes.
 */
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Writable } from 'node:stream'
import { createDeflate } from 'node:zlib'
import { ATTACHMENT_MAX_BYTES, checkAttachSize, type AttachSizeVerdict } from '@reading-book/book-reader-sdk'
import { isReadmateTempFor, writeFileSafelyStreaming } from './pdf-annotation-export'
import { finishAttachmentXref, type AttachmentUpdatePlan } from './pdf-incremental-writer'

export type StagedAttachment = {
  /** App-owned copy of the picked file — the ONLY source the write reads. */
  stagedPath: string
  sizeBytes: number
  sha256: string
  md5Hex: string
  /** Source mtime (ISO 8601). */
  modifiedAt: string
  /** Removes the staging folder; safe to call twice. */
  cleanup: () => Promise<void>
}

export type StageFailure =
  | Exclude<AttachSizeVerdict, { ok: true }>
  | { ok: false; code: 'read_failed'; errno?: string }
  | { ok: false; code: 'source_changed' }

export type StageResult = { ok: true; staged: StagedAttachment } | StageFailure

export type StageOptions = {
  /** Size of the PDF the file will be written into (the combined limit). */
  pdfSizeBytes: number
  /** Opens the source for reading — injectable so the spikes can prove an over-limit file is never opened. */
  openRead?: (sourcePath: string) => fs.ReadStream
}

function errnoOf(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : undefined
}

/**
 * Copy the picked file into `{stagingRoot}/{uuid}/content` (research R4): it must be a regular file (a link is
 * followed once); its size is checked BEFORE it is opened (FR-011); the copy counts bytes and hashes them
 * (SHA-256 + MD5) and fails `source_changed` when the file grows, shrinks or is modified meanwhile (FR-013).
 */
export async function stageAttachmentSource(sourcePath: string, stagingRoot: string, options: StageOptions): Promise<StageResult> {
  let before: fs.Stats
  try {
    const link = await fsp.lstat(sourcePath)
    before = link.isSymbolicLink() ? await fsp.stat(sourcePath) : link
  } catch (err) {
    return { ok: false, code: 'read_failed', errno: errnoOf(err) }
  }
  if (!before.isFile()) return { ok: false, code: 'read_failed', errno: 'ENOTFILE' }
  const size = checkAttachSize(before.size, options.pdfSizeBytes)
  if (!size.ok) return size

  const dir = path.join(stagingRoot, randomUUID())
  const cleanup = async () => {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
  const stagedPath = path.join(dir, 'content')
  const sha = createHash('sha256')
  const md5 = createHash('md5')
  let count = 0
  let tooMuch = false
  try {
    await fsp.mkdir(dir, { recursive: true })
    const source = (options.openRead ?? ((p: string) => fs.createReadStream(p)))(sourcePath)
    const out = fs.createWriteStream(stagedPath, { flags: 'wx' })
    await pipeline(
      source,
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          count += chunk.length
          if (count > before.size || count > ATTACHMENT_MAX_BYTES) {
            tooMuch = true
            throw new Error('the file grew while it was being read')
          }
          sha.update(chunk)
          md5.update(chunk)
          yield chunk
        }
      },
      out,
    )
  } catch (err) {
    await cleanup()
    return tooMuch ? { ok: false, code: 'source_changed' } : { ok: false, code: 'read_failed', errno: errnoOf(err) }
  }
  try {
    const after = await fsp.stat(sourcePath)
    if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      await cleanup()
      return { ok: false, code: 'source_changed' }
    }
  } catch {
    await cleanup()
    return { ok: false, code: 'source_changed' }
  }
  return {
    ok: true,
    staged: { stagedPath, sizeBytes: count, sha256: sha.digest('hex'), md5Hex: md5.digest('hex'), modifiedAt: before.mtime.toISOString(), cleanup },
  }
}

/** Raised when the staged copy no longer hashes to what was checked (it is app-owned; this means tampering or disk corruption). */
export class StagedContentChangedError extends Error {}

/**
 * Stream `bytes` + `plan` into `write`: the original bytes, then each planned object, the content object being
 * the staged file deflated on the fly, its indirect `/Length` written right after with the counted size, then
 * the xref section with the offsets counted while writing. Returns the total size written.
 */
export async function writePlannedUpdate(
  write: (chunk: Uint8Array) => Promise<void>,
  bytes: Uint8Array,
  plan: AttachmentUpdatePlan,
  content: { stagedPath: string; sha256: string },
): Promise<number> {
  let offset = 0
  const put = async (chunk: Uint8Array) => {
    if (chunk.length === 0) return
    await write(chunk)
    offset += chunk.length
  }
  const text = (s: string) => put(Buffer.from(s, 'latin1'))
  await put(bytes)
  await text(plan.lead)
  const offsets = new Map<number, number>()
  let contentLength: number | null = null
  for (const object of plan.objects) {
    offsets.set(object.num, offset)
    if ('body' in object) {
      await text(`${object.num} ${object.gen} obj\n${object.body}\nendobj\n`)
    } else if ('content' in object) {
      await text(`${object.num} ${object.gen} obj\n<< ${object.streamDict} >>\nstream\n`)
      const start = offset
      const hash = createHash('sha256')
      await pipeline(
        fs.createReadStream(content.stagedPath),
        async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) {
            hash.update(chunk)
            yield chunk
          }
        },
        createDeflate(),
        new Writable({
          write(chunk: Buffer, _encoding, done) {
            put(chunk).then(() => done(), done)
          },
        }),
      )
      if (hash.digest('hex') !== content.sha256) throw new StagedContentChangedError('the staged attachment changed')
      contentLength = offset - start
      await text('\nendstream\nendobj\n')
    } else {
      if (contentLength === null) throw new Error('the /Length object comes before its stream')
      await text(`${object.num} ${object.gen} obj\n${contentLength}\nendobj\n`)
    }
  }
  await text(finishAttachmentXref(plan, offsets, offset))
  return offset
}

const WRITE_BATCH_BYTES = 1024 * 1024

/** The target is not the version that was read and planned (another program saved it meanwhile). */
export class TargetChangedError extends Error {}

/** The written temp file failed its read-back (`verify` returned a reason). */
export class AttachmentVerifyError extends Error {}

export type AttachmentWriteInput = {
  /** The book's PDF (validated path). */
  target: string
  /** Its bytes as read and planned. */
  bytes: Uint8Array
  /** SHA-256 of `bytes`. */
  bytesSha256: string
  plan: AttachmentUpdatePlan
  content: { stagedPath: string; sha256: string }
  /** Read-back of the temp file: null = good, otherwise why it is not (research R6). */
  verify: (tempPath: string) => Promise<string | null>
}

/**
 * Write the update to a temp file beside `target`, flush, verify the temp file, check `target` is still the
 * planned version, then rename (research R5–R6). Any failure leaves `target` untouched and no temp file behind.
 * Orphan temp files of earlier crashed writes of THIS target are removed first.
 */
export async function writeAttachmentUpdate(input: AttachmentWriteInput): Promise<void> {
  await sweepOrphanTemps(input.target)
  await writeFileSafelyStreaming(
    input.target,
    async (handle) => {
      // Deflate emits ~16 KB pieces: gather them so the file gets few large writes.
      const pending: Uint8Array[] = []
      let pendingBytes = 0
      const flush = async () => {
        if (pendingBytes === 0) return
        await handle.write(Buffer.concat(pending, pendingBytes))
        pending.length = 0
        pendingBytes = 0
      }
      await writePlannedUpdate(
        async (chunk) => {
          if (chunk.length >= WRITE_BATCH_BYTES) {
            await flush()
            await handle.write(chunk)
            return
          }
          pending.push(chunk)
          pendingBytes += chunk.length
          if (pendingBytes >= WRITE_BATCH_BYTES) await flush()
        },
        input.bytes,
        input.plan,
        input.content,
      )
      await flush()
    },
    async (tempPath) => {
      const problem = await input.verify(tempPath)
      if (problem) throw new AttachmentVerifyError(problem)
      const now = await fsp.readFile(input.target)
      if (now.length !== input.bytes.length || createHash('sha256').update(now).digest('hex') !== input.bytesSha256) {
        throw new TargetChangedError('the PDF changed while the attachment was being written')
      }
    },
  )
}

export type AttachmentChangeWriteInput = {
  target: string
  /** The bytes as read and planned, and their SHA-256. */
  bytes: Uint8Array
  bytesSha256: string
  /** `bytes` + the move / delete update. */
  next: Uint8Array
  verify: (tempPath: string) => Promise<string | null>
}

/**
 * A move / delete (no content to stream): the same temp → fsync → verify → re-check → rename path as
 * `writeAttachmentUpdate`, so a failure leaves `target` untouched and no temp file behind.
 */
export async function writeAttachmentChange(input: AttachmentChangeWriteInput): Promise<void> {
  await sweepOrphanTemps(input.target)
  await writeFileSafelyStreaming(
    input.target,
    async (handle) => {
      for (let at = 0; at < input.next.length; at += WRITE_BATCH_BYTES * 8) {
        await handle.write(input.next.subarray(at, Math.min(input.next.length, at + WRITE_BATCH_BYTES * 8)))
      }
    },
    async (tempPath) => {
      const problem = await input.verify(tempPath)
      if (problem) throw new AttachmentVerifyError(problem)
      const now = await fsp.readFile(input.target)
      if (now.length !== input.bytes.length || createHash('sha256').update(now).digest('hex') !== input.bytesSha256) {
        throw new TargetChangedError('the PDF changed while the attachment was being changed')
      }
    },
  )
}

/** Remove `.{name}.readmate-{hex}.tmp` files beside `target` (only that exact pattern; T018). */
export async function sweepOrphanTemps(target: string): Promise<void> {
  const dir = path.dirname(target)
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (isReadmateTempFor(target, name)) await fsp.rm(path.join(dir, name), { force: true }).catch(() => {})
  }
}

/** `write_failed` detail for an I/O error (ENOSPC, EIO, EPERM…). */
export function attachmentWriteErrno(err: unknown): string | undefined {
  return errnoOf(err)
}
