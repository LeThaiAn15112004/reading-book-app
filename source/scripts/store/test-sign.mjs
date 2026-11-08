// Spec 010 T020 — local test signing of the Store package (research R10, contracts/store-build.md "Environment").
//
// The upload package is unsigned (the Store signs it). `npm run package:store -- --test-sign` signs with a
// self-signed certificate for sideloading only:
//   READMATE_STORE_TEST_PFX           absolute path of the .pfx, OUTSIDE the repository
//   READMATE_STORE_TEST_PFX_PASSWORD  its password — never printed, never written; handed only to the
//                                     electron-builder child as WIN_CSC_KEY_PASSWORD
// The certificate subject must equal appx.publisher (store-identity.json), or nothing is built.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const DAY_MS = 24 * 60 * 60 * 1000
const WARN_DAYS = 30

/** Removes every occurrence of `secret` from `text`. */
export function scrub(text, secret) {
  const s = String(text ?? '')
  return secret ? s.split(secret).join('***') : s
}

function isInside(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Whether this run asks for test signing, and how. `npm run package:store -- --test-sign` typed in Windows PowerShell
 * goes through npm.ps1, which drops the `--`: npm then takes `--test-sign` as ITS OWN config ("npm warn Unknown cli
 * config"), the script receives no argument, and npm sets `npm_config_test_sign=true` in its environment instead.
 * That form is honoured too (and reported), so the request is never lost silently.
 * Returns `null` (unsigned) | `'argv'` | `'npm-config'`.
 */
export function testSignRequest(argv, env) {
  if (argv.includes('--test-sign')) return 'argv'
  const npmFlag = env?.npm_config_test_sign
  if (typeof npmFlag === 'string' && npmFlag !== '' && npmFlag.toLowerCase() !== 'false') return 'npm-config'
  return null
}

/**
 * Pure decision (readSubject injected). Returns
 * `{ signing: false }` without --test-sign, else
 * `{ signing: true, errors: {code, message}[], warnings: string[], subject?, env? }` — `env` only when there is no error.
 */
export function resolveTestSigning({ argv, env, repoRoot, publisher, readSubject, now = new Date() }) {
  const requestedBy = testSignRequest(argv, env)
  if (!requestedBy) return { signing: false, requestedBy: null, errors: [], warnings: [] }
  const errors = []
  const warnings = []
  if (requestedBy === 'npm-config') {
    warnings.push(
      '--test-sign reached npm, not this script (Windows PowerShell drops the "--" of `npm run … -- --test-sign`); ' +
        'taken from npm_config_test_sign. To pass it directly, run `npm.cmd run package:store -- --test-sign`.',
    )
  }
  const pfx = env.READMATE_STORE_TEST_PFX
  const password = env.READMATE_STORE_TEST_PFX_PASSWORD
  for (const [name, value] of [
    ['READMATE_STORE_TEST_PFX', pfx],
    ['READMATE_STORE_TEST_PFX_PASSWORD', password],
  ]) {
    if (!value) errors.push({ code: 'test_sign_env_missing', message: `--test-sign needs ${name} (see docs/store/signing.md)` })
  }
  if (errors.length) return { signing: true, errors, warnings }

  const missing = { code: 'test_sign_pfx_missing', message: `READMATE_STORE_TEST_PFX must be the absolute path of an existing .pfx: ${pfx}` }
  if (!path.isAbsolute(pfx)) return { signing: true, errors: [missing], warnings }
  // Checked before existence: a certificate inside the repository is refused even before it is created there.
  if (isInside(repoRoot, pfx)) {
    return { signing: true, errors: [{ code: 'cert_in_repo', message: 'The test certificate must be outside the repository' }], warnings }
  }
  if (!existsSync(pfx)) return { signing: true, errors: [missing], warnings }

  let info
  try {
    info = readSubject(pfx, password)
  } catch (err) {
    return {
      signing: true,
      errors: [{ code: 'test_sign_pfx_unreadable', message: `Cannot read the test certificate: ${scrub(err?.message ?? err, password)}` }],
      warnings,
    }
  }
  const subject = String(info?.subject ?? '').trim()
  if (subject !== publisher) {
    errors.push({ code: 'cert_subject_mismatch', message: `Test certificate subject "${scrub(subject, password)}" ≠ appx.publisher "${publisher}"` })
  }
  const notAfter = info?.notAfter ? new Date(info.notAfter) : null
  if (notAfter && !Number.isNaN(notAfter.getTime())) {
    const daysLeft = (notAfter.getTime() - now.getTime()) / DAY_MS
    if (daysLeft <= 0) errors.push({ code: 'test_sign_cert_expired', message: `The test certificate expired on ${notAfter.toISOString().slice(0, 10)}` })
    else if (daysLeft < WARN_DAYS) warnings.push(`The test certificate expires on ${notAfter.toISOString().slice(0, 10)} (in ${Math.floor(daysLeft)} days)`)
  }
  if (errors.length) return { signing: true, errors, warnings, subject }
  return { signing: true, errors, warnings, subject, env: { WIN_CSC_LINK: pfx, WIN_CSC_KEY_PASSWORD: password } }
}


// Fixed script: the path and password come only from this child's environment, never from its command line.
const READ_PFX_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet',
  '$c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($env:READMATE_CHILD_PFX, $env:READMATE_CHILD_PFX_PW, $flags)',
  "if (-not $c.HasPrivateKey) { throw 'the .pfx has no private key' }",
  "@{ subject = $c.Subject; notAfter = $c.NotAfter.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress",
].join('; ')

/** Reads `{ subject, notAfter }` of a .pfx with Windows PowerShell (.NET X509Certificate2). Throws on failure. */
export function readPfxSubject(pfxPath, password) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', READ_PFX_SCRIPT], {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    env: { ...process.env, READMATE_CHILD_PFX: pfxPath, READMATE_CHILD_PFX_PW: password },
  })
  if (r.error) throw new Error(scrub(r.error.message, password))
  if (r.status !== 0) {
    const firstLine = scrub(r.stderr, password).split(/\r?\n/).find((l) => l.trim()) ?? `exit ${r.status}`
    throw new Error(firstLine.trim())
  }
  const line = r.stdout.trim().split(/\r?\n/).pop()
  const parsed = JSON.parse(line)
  return { subject: parsed.subject, notAfter: parsed.notAfter }
}
