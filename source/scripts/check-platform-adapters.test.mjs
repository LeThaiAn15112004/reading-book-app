// Negative tests of check-platform-adapters (T040) and of the R12 lint rule: each probe must fail.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, test } from 'node:test'
import { checkPlatformAdapters } from './check-platform-adapters.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const roots = []
const tree = (files) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'adapters-'))
  roots.push(root)
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, 'source/app/platforms', name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  return root
}
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true })
})

describe('check-platform-adapters', () => {
  test('a matching pair passes', () => {
    const root = tree({
      'host.electron.ts': 'export const isMobileHost = () => false\nexport function isFeatureAvailable() { return true }\nexport type Host = 1\n',
      'host.native.ts': 'const f = () => true\nexport { f as isFeatureAvailable }\nexport const isMobileHost = () => true\nexport type Host = 2\n',
    })
    assert.deepEqual(checkPlatformAdapters(root), { concerns: 1, violations: [] })
  })

  test('a concern with one file fails', () => {
    const { violations } = checkPlatformAdapters(tree({ 'storage.electron.ts': 'export const a = 1\n' }))
    assert.equal(violations.length, 1)
    assert.match(violations[0], /only storage\.electron\.ts/)
  })

  test('different export names fail', () => {
    const { violations } = checkPlatformAdapters(
      tree({ 'api.electron.ts': 'export const a = 1\nexport const b = 2\n', 'api.native.ts': 'export const a = 1\nexport const c = 3\n' }),
    )
    assert.equal(violations.length, 1)
    assert.match(violations[0], /only in api\.electron\.ts: b; only in api\.native\.ts: c/)
  })

  test('"export *" is refused, and .tsx files pair too', () => {
    const { violations } = checkPlatformAdapters(
      tree({ 'view.electron.tsx': 'export * from "./x"\n', 'view.native.tsx': 'export const V = () => null\n' }),
    )
    assert.ok(violations.some((v) => /export \* from/.test(v)))
  })

  test('the real repository passes', () => {
    assert.deepEqual(checkPlatformAdapters().violations, [])
  })
})

describe('R12: no suffixed import outside source/app/platforms (ESLint)', () => {
  const { ESLint } = createRequire(path.join(repoRoot, 'package.json'))('eslint')
  const eslint = new ESLint({ cwd: repoRoot })
  const lint = async (file, code) => (await eslint.lintText(code, { filePath: path.join(repoRoot, file) }))[0].messages
  const r12 = (msgs) => msgs.some((m) => m.ruleId === 'no-restricted-imports' && /R12/.test(m.message))

  test('a screen importing host.electron fails', async () => {
    assert.ok(r12(await lint('source/app/screens/__probe.ts', "import { x } from '../platforms/host.electron'\nexport const a = x\n")))
  })
  test('a screen importing host.native.ts fails', async () => {
    assert.ok(r12(await lint('source/app/screens/__probe.ts', "import { x } from '../platforms/host.native.ts'\nexport const a = x\n")))
  })
  test('the suffix-free import passes', async () => {
    assert.ok(!r12(await lint('source/app/screens/__probe.ts', "import { x } from '@app/platforms/host'\nexport const a = x\n")))
  })
  test('inside source/app/platforms the suffixed import passes', async () => {
    assert.ok(!r12(await lint('source/app/platforms/__probe.ts', "import { x } from './host.electron'\nexport const a = x\n")))
  })
})
