// Spec 010 T012 — tests for check-store-secrets.mjs on a temporary git repository.
// Run: node --test source/scripts/store/check-store-secrets.test.mjs  (part of `npm run check:store-secrets`)
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { findTrackedSecrets } from './check-store-secrets.mjs'

// Built at run time so this file itself never contains a key block.
const header = (kind) => ['-----BEGIN', kind, 'KEY-----'].join(' ')
const footer = (kind) => ['-----END', kind, 'KEY-----'].join(' ')
const BODY = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7'.repeat(3).match(/.{1,64}/g).join('\n')
const block = (kind, body = BODY) => `${header(kind)}\n${body}\n${footer(kind)}\n`

const dirs = []
function repo(files, { ignore = [] } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'readmate-secrets-'))
  dirs.push(dir)
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git('init', '-q')
  if (ignore.length) writeFileSync(path.join(dir, '.gitignore'), ignore.join('\n') + '\n')
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content)
  git('add', '-A')
  return dir
}
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

const names = (hits) => hits.map((h) => h.file).sort()

describe('check-store-secrets', () => {
  it('passes a repository without secrets', () => {
    assert.deepEqual(findTrackedSecrets(repo({ 'a.txt': 'hello', 'b.json': '{}' })), [])
  })
  it('fails on a tracked .pfx and .p12 (any case)', () => {
    assert.deepEqual(names(findTrackedSecrets(repo({ 'x.pfx': 'bin', 'Y.P12': 'bin', 'ok.txt': 'x' }))), ['Y.P12', 'x.pfx'])
  })
  for (const kind of ['PRIVATE', 'RSA PRIVATE', 'ENCRYPTED PRIVATE', 'EC PRIVATE']) {
    it(`fails on a "${kind} KEY" PEM block in a text file`, () => {
      const hits = findTrackedSecrets(repo({ 'key.pem': block(kind) }))
      assert.deepEqual(names(hits), ['key.pem'])
      assert.equal(hits[0].reason, 'PEM private key block')
    })
  }
  it('fails on a legacy encrypted block with Proc-Type / DEK-Info headers', () => {
    const body = `Proc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,0123456789ABCDEF\n\n${BODY}`
    assert.deepEqual(names(findTrackedSecrets(repo({ 'legacy.key': block('RSA PRIVATE', body) }))), ['legacy.key'])
  })
  it('does not flag prose that only names the header, or a header with a too-short body', () => {
    const prose = `Fail on a file with ${header('PRIVATE')} / ${header('RSA PRIVATE')} in it.\n`
    const files = { 'tasks.md': prose, 'short.pem': block('PRIVATE', 'MIIB'), 'words.md': block('PRIVATE', 'not a key, just words') }
    assert.deepEqual(findTrackedSecrets(repo(files)), [])
  })
  it('does not flag a public certificate', () => {
    const cert = ['-----BEGIN', 'CERTIFICATE-----'].join(' ') + `\n${BODY}\n` + ['-----END', 'CERTIFICATE-----'].join(' ')
    assert.deepEqual(findTrackedSecrets(repo({ 'cert.pem': cert })), [])
  })
  it('ignores an untracked (git-ignored) .pfx', () => {
    assert.deepEqual(findTrackedSecrets(repo({ 'local.pfx': 'bin', 'a.txt': 'x' }, { ignore: ['*.pfx'] })), [])
  })
  it('skips binary files', () => {
    const bin = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(block('PRIVATE'))])
    assert.deepEqual(findTrackedSecrets(repo({ 'img.bin': bin })), [])
  })
})
