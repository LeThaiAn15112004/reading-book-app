import { app } from 'electron'
import fs from 'node:fs'
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
