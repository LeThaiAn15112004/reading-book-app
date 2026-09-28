import { resolveFormatFromExtension } from '@reading-book/config'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * Where a book's file lives.
 * - `managed`: an app-owned copy under `{userData}/books/{uuid}/` (URL / cloud downloads, and every
 *   book imported before the reference-based library). The app may delete it.
 * - `referenced`: the user's own file, registered by absolute path. The app must never write to,
 *   move or delete it — and never its parent folder.
 */
export type BookFileStorage = 'managed' | 'referenced'

/** Absolute path to `{userData}/books`. */
export function getBooksSandboxPath(): string {
  return path.join(app.getPath('userData'), 'books')
}

/** Create the books sandbox directory if missing; return its absolute path. */
export function ensureBooksSandbox(): string {
  const root = getBooksSandboxPath()
  fs.mkdirSync(root, { recursive: true })
  return root
}

/** Absolute path to `{userData}/covers` — extracted cover images, one file per book. */
export function getCoversPath(): string {
  return path.join(app.getPath('userData'), 'covers')
}

/** Create the covers directory if missing; return its absolute path. */
export function ensureCoversDir(): string {
  const root = getCoversPath()
  fs.mkdirSync(root, { recursive: true })
  return root
}

function normalizeForCompare(p: string): string {
  const resolved = path.resolve(p)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isInsideDir(root: string, candidate: string): boolean {
  const relative = path.relative(normalizeForCompare(root), normalizeForCompare(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * True if `candidate` resolves inside the books sandbox (or is the sandbox root).
 * Rejects path traversal (`..`) and paths outside the allowlist root.
 */
export function isPathInsideSandbox(candidate: string): boolean {
  return isInsideDir(getBooksSandboxPath(), candidate)
}

/** True if `candidate` resolves inside `{userData}/covers`. */
export function isPathInsideCovers(candidate: string): boolean {
  return isInsideDir(getCoversPath(), candidate)
}

/** True if `candidate` resolves anywhere inside Electron's `userData` (app-owned storage). */
export function isPathInsideUserData(candidate: string): boolean {
  return isInsideDir(app.getPath('userData'), candidate)
}

/**
 * Throw if `candidate` is outside the sandbox; otherwise return the resolved absolute path.
 * Only for app-owned copies — user-owned book files go through `resolveBookFile`.
 */
export function assertPathAllowed(candidate: string): string {
  const resolved = path.resolve(candidate)
  if (!isPathInsideSandbox(resolved)) {
    throw new Error(`Path not allowed outside books sandbox: ${resolved}`)
  }
  return resolved
}

/** Cover images may live in `{userData}/covers` or (legacy imports) next to a sandboxed book. */
export function assertCoverPathAllowed(candidate: string): string {
  const resolved = path.resolve(candidate)
  if (!isPathInsideCovers(resolved) && !isPathInsideSandbox(resolved)) {
    throw new Error(`Cover path not allowed: ${resolved}`)
  }
  return resolved
}

/** Classify a registered `books.file_path`. Pure path logic — no filesystem access. */
export function bookFileStorage(filePath: string): BookFileStorage {
  return isPathInsideSandbox(filePath) ? 'managed' : 'referenced'
}

export type BookPathCheck =
  | { ok: true; path: string; storage: BookFileStorage }
  | { ok: false; code: 'path_denied' }

/**
 * Validate a registered book path without touching the disk.
 *
 * Renderer code never supplies paths (IPC is keyed by book id), so this guards against a bad or
 * tampered `books.file_path` rather than a live attacker: it must be an absolute, non-device path,
 * and — unless it is an app-owned sandbox copy — carry the extension of the book's own format, so
 * a row can't be used to read an arbitrary file.
 */
export function checkRegisteredBookPath(filePath: string, format: string): BookPathCheck {
  if (!filePath || !path.isAbsolute(filePath)) return { ok: false, code: 'path_denied' }
  // \\?\ and \\.\ bypass Win32 path normalisation.
  if (process.platform === 'win32' && /^[\\/]{2}[?.][\\/]/.test(filePath)) {
    return { ok: false, code: 'path_denied' }
  }
  const resolved = path.resolve(filePath)
  if (isPathInsideSandbox(resolved)) return { ok: true, path: resolved, storage: 'managed' }
  if (resolveFormatFromExtension(path.extname(resolved).toLowerCase()) !== format) {
    return { ok: false, code: 'path_denied' }
  }
  return { ok: true, path: resolved, storage: 'referenced' }
}

export type BookFileResolution =
  | { ok: true; path: string; storage: BookFileStorage }
  | { ok: false; code: 'path_denied' | 'missing_file' | 'read_failed' }

function isMissingError(err: unknown): boolean {
  const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : ''
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * Resolve a book's registered path to a readable regular file, or say why not.
 * The returned path is the one to read (symlinks resolved for referenced files, and the extension
 * re-checked on the target so a link can't retarget a book at an unrelated file type).
 */
export async function resolveBookFile(book: {
  filePath: string
  format: string
}): Promise<BookFileResolution> {
  const checked = checkRegisteredBookPath(book.filePath, book.format)
  if (!checked.ok) return checked

  try {
    let target = checked.path
    if (checked.storage === 'referenced') {
      target = await fsp.realpath(checked.path)
      if (resolveFormatFromExtension(path.extname(target).toLowerCase()) !== book.format) {
        return { ok: false, code: 'path_denied' }
      }
    }
    const stat = await fsp.stat(target)
    if (!stat.isFile()) return { ok: false, code: 'missing_file' }
    await fsp.access(target, fs.constants.R_OK)
    return { ok: true, path: target, storage: checked.storage }
  } catch (err) {
    return { ok: false, code: isMissingError(err) ? 'missing_file' : 'read_failed' }
  }
}

/**
 * Copy a local file into `{userData}/books/{uuid}/{originalBasename}`.
 * Never moves or mutates the source (BR-01). Destination is set read-only.
 * On failure, removes the partial UUID folder.
 *
 * Only for files that have no lasting home on the user's disk (URL / cloud downloads); books the
 * user picks from their own filesystem are registered by reference instead.
 */
export async function copyIntoBooksSandbox(sourcePath: string): Promise<string> {
  const root = ensureBooksSandbox()
  const basename = path.basename(sourcePath)
  if (!basename || basename === '.' || basename === '..') {
    throw new Error('Invalid source filename')
  }

  const destDir = path.join(root, randomUUID())
  const destPath = path.join(destDir, basename)

  try {
    await fsp.mkdir(destDir, { recursive: true })
    await fsp.copyFile(sourcePath, destPath)
    await fsp.chmod(destPath, 0o444)
    return assertPathAllowed(destPath)
  } catch (err) {
    await fsp.rm(destDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

/**
 * Delete the `{userData}/books/{uuid}/` folder that holds a managed book file.
 *
 * Refuses (returns false) for anything that isn't exactly `{sandbox}/{uuid}/{file}` — in particular
 * a referenced book's parent folder (e.g. `D:\Books`) and the sandbox root itself.
 */
export async function removeManagedBookDir(filePath: string): Promise<boolean> {
  const resolvedFile = path.resolve(filePath)
  const bookDir = path.dirname(resolvedFile)
  if (normalizeForCompare(path.dirname(bookDir)) !== normalizeForCompare(getBooksSandboxPath())) {
    return false
  }
  await fsp.chmod(resolvedFile, 0o666).catch(() => {})
  await fsp.rm(bookDir, { recursive: true, force: true })
  return true
}

/** Delete an extracted cover image, only if it lives in `{userData}/covers`. */
export async function removeCoverFile(coverPath: string | undefined): Promise<void> {
  if (!coverPath || !isPathInsideCovers(coverPath)) return
  await fsp.rm(path.resolve(coverPath), { force: true }).catch(() => {})
}
