import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

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

function normalizeForCompare(p: string): string {
  const resolved = path.resolve(p)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * True if `candidate` resolves inside the books sandbox (or is the sandbox root).
 * Rejects path traversal (`..`) and paths outside the allowlist root.
 */
export function isPathInsideSandbox(candidate: string): boolean {
  const root = normalizeForCompare(getBooksSandboxPath())
  const resolved = normalizeForCompare(candidate)
  const relative = path.relative(root, resolved)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Throw if `candidate` is outside the sandbox; otherwise return the resolved absolute path.
 */
export function assertPathAllowed(candidate: string): string {
  const resolved = path.resolve(candidate)
  if (!isPathInsideSandbox(resolved)) {
    throw new Error(`Path not allowed outside books sandbox: ${resolved}`)
  }
  return resolved
}

/**
 * Copy a local file into `{userData}/books/{uuid}/{originalBasename}`.
 * Never moves or mutates the source (BR-01). Destination is set read-only.
 * On failure, removes the partial UUID folder.
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
