import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PENDING_VI_AREAS } from '../../src/i18n/registry'

/**
 * Spec 012 release gate (clarification 1): the Vietnamese interface ships only when nothing is left pending — no
 * catalogue area marked `pendingArea(...)` and no UI file still carrying the `/* i18n-pending: <area> *\/` header that
 * exempts it from the `readmate/no-ui-literals` lint rule. This test failing means "not releasable", not "flaky".
 */

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../app')
const SKIP = /(^|[\\/])(node_modules|dist|dist-electron|release|web-dist)([\\/]|$)/

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP.test(full)) sourceFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('i18n release gate (spec 012)', () => {
  it('no Vietnamese catalogue area is pending', () => {
    expect(PENDING_VI_AREAS).toEqual([])
  })

  it('no file under source/app starts with an i18n-pending header', () => {
    const files = sourceFiles(APP_ROOT)
    expect(files.length).toBeGreaterThan(100) // the walk really saw the app
    const pending = files
      .filter((file) => /^﻿?\/\*\s*i18n-pending:/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(APP_ROOT, file).replaceAll('\\', '/'))
    expect(pending).toEqual([])
  })
})
