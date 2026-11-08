// Spec 010 T019 — tests for resolveTestSigning (contracts/store-build.md "Environment", research R10).
// Run: node --test source/scripts/store/test-sign.test.mjs  (part of `npm run check:store-config -- --self-test`)
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { resolveTestSigning } from './test-sign.mjs'

const PUBLISHER = 'CN=E2395284-7996-4927-857C-B41F415D298E'
const PASSWORD = 'pa$$-w0rd-never-printed'
const NOW = new Date('2026-11-08T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000

const outside = mkdtempSync(path.join(os.tmpdir(), 'readmate-sign-'))
const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'readmate-repo-'))
const pfxOutside = path.join(outside, 'readmate-store-test.pfx')
const pfxInside = path.join(repoRoot, 'certs', 'test.pfx')
writeFileSync(pfxOutside, 'not a real pfx')
after(() => {
  rmSync(outside, { recursive: true, force: true })
  rmSync(repoRoot, { recursive: true, force: true })
})

const subject = (s, notAfter = new Date(NOW.getTime() + 365 * DAY)) => () => ({ subject: s, notAfter: notAfter.toISOString() })
function run(over = {}) {
  return resolveTestSigning({
    argv: over.argv ?? ['--test-sign'],
    env: over.env ?? { READMATE_STORE_TEST_PFX: pfxOutside, READMATE_STORE_TEST_PFX_PASSWORD: PASSWORD },
    repoRoot,
    publisher: PUBLISHER,
    readSubject: over.readSubject ?? subject(PUBLISHER),
    now: NOW,
  })
}
const codes = (r) => r.errors.map((e) => e.code)
const everyText = (r) => JSON.stringify({ errors: r.errors, warnings: r.warnings, subject: r.subject })

describe('resolveTestSigning', () => {
  it('without --test-sign: not signing, no checks, no env', () => {
    const r = run({ argv: [], env: {} })
    assert.equal(r.signing, false)
    assert.deepEqual(r.errors, [])
    assert.equal(r.env, undefined)
  })

  it('success returns WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD for the electron-builder child only', () => {
    const r = run()
    assert.equal(r.signing, true)
    assert.deepEqual(r.errors, [])
    assert.deepEqual(r.env, { WIN_CSC_LINK: pfxOutside, WIN_CSC_KEY_PASSWORD: PASSWORD })
    assert.equal(r.subject, PUBLISHER)
  })

  for (const missing of ['READMATE_STORE_TEST_PFX', 'READMATE_STORE_TEST_PFX_PASSWORD']) {
    it(`--test-sign without ${missing} → error naming it`, () => {
      const env = { READMATE_STORE_TEST_PFX: pfxOutside, READMATE_STORE_TEST_PFX_PASSWORD: PASSWORD }
      delete env[missing]
      const r = run({ env })
      assert.deepEqual(codes(r), ['test_sign_env_missing'])
      assert.match(r.errors[0].message, new RegExp(missing))
    })
  }

  it('a PFX inside the repository → cert_in_repo', () => {
    const r = run({ env: { READMATE_STORE_TEST_PFX: pfxInside, READMATE_STORE_TEST_PFX_PASSWORD: PASSWORD } })
    assert.deepEqual(codes(r), ['cert_in_repo'])
  })

  it('a relative path → error (must be absolute)', () => {
    const r = run({ env: { READMATE_STORE_TEST_PFX: 'certs/test.pfx', READMATE_STORE_TEST_PFX_PASSWORD: PASSWORD } })
    assert.deepEqual(codes(r), ['test_sign_pfx_missing'])
  })

  it('a PFX that does not exist → error', () => {
    const r = run({ env: { READMATE_STORE_TEST_PFX: path.join(outside, 'nope.pfx'), READMATE_STORE_TEST_PFX_PASSWORD: PASSWORD } })
    assert.deepEqual(codes(r), ['test_sign_pfx_missing'])
  })

  it('subject ≠ publisher → cert_subject_mismatch with both values', () => {
    const r = run({ readSubject: subject('CN=Wrong') })
    assert.deepEqual(codes(r), ['cert_subject_mismatch'])
    assert.equal(r.errors[0].message, `Test certificate subject "CN=Wrong" ≠ appx.publisher "${PUBLISHER}"`)
    assert.equal(r.env, undefined)
  })

  it('an unreadable PFX (wrong password, not a PFX) → test_sign_pfx_unreadable, password scrubbed', () => {
    const r = run({
      readSubject: () => {
        throw new Error(`could not open with ${PASSWORD}: The specified network password is not correct.`)
      },
    })
    assert.deepEqual(codes(r), ['test_sign_pfx_unreadable'])
    assert.ok(!everyText(r).includes(PASSWORD))
  })

  it('expires within 30 days → warning, still signs', () => {
    const r = run({ readSubject: subject(PUBLISHER, new Date(NOW.getTime() + 10 * DAY)) })
    assert.deepEqual(r.errors, [])
    assert.equal(r.warnings.length, 1)
    assert.match(r.warnings[0], /expires/)
  })

  it('already expired → error', () => {
    const r = run({ readSubject: subject(PUBLISHER, new Date(NOW.getTime() - DAY)) })
    assert.deepEqual(codes(r), ['test_sign_cert_expired'])
  })

  it('no returned text ever contains the password', () => {
    for (const r of [run(), run({ readSubject: subject('CN=Wrong') }), run({ env: { READMATE_STORE_TEST_PFX: pfxInside, READMATE_STORE_TEST_PFX_PASSWORD: PASSWORD } })]) {
      assert.ok(!everyText(r).includes(PASSWORD))
    }
  })
})
