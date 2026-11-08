// Spec 010 T013 — checks the Microsoft Store package inputs before anything is built
// (contracts/store-build.md "Errors", data-model §1 Store identity, §2 Release version).
//
//   node source/scripts/store/check-store-config.mjs                       # release: placeholders are errors
//   node source/scripts/store/check-store-config.mjs --allow-placeholders  # npm run check: shapes only
//   node source/scripts/store/check-store-config.mjs --self-test           # also runs every store/*.test.mjs
//
// Every error of a run is printed together; exit 1 when there is any. Cross-platform (part of `npm run check`).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLACEHOLDER = '__FROM_PARTNER_CENTER__'
const PLACEHOLDER_VALUES = new Set([PLACEHOLDER, 'YourAppID'])
const PARTNER_CENTER_FIELDS = ['identityName', 'publisher', 'publisherDisplayName']
const ALL_TEXT_FIELDS = [...PARTNER_CENTER_FIELDS, 'applicationId', 'displayName']
const RESERVED_APPLICATION_IDS = new Set(
  ['CON', 'PRN', 'AUX', 'NUL', ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)],
)
const STARTUP_TASK_ID = 'ReadmateReaderStartup'
/** Results that mean the package was actually sent to the Store (docs/store/submissions.md). */
const SUBMITTED_RESULTS = new Set(['submitted', 'certified', 'published', 'rejected'])

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')
export const PATHS = {
  identity: path.join(repoRoot, 'source/app/platforms/electron/store/store-identity.json'),
  extensions: path.join(repoRoot, 'source/app/platforms/electron/store/appx-extensions.xml'),
  builderConfig: path.join(repoRoot, 'electron-builder.json5'),
  submissions: path.join(repoRoot, 'docs/store/submissions.md'),
}

const isPlaceholder = (v) => typeof v === 'string' && PLACEHOLDER_VALUES.has(v.trim())
const isBlank = (v) => typeof v !== 'string' || v.trim() === ''
const WINDOWS_VERSION = /^\d+\.\d+\.\d+\.\d+$/

function compareWindowsVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** `MAJOR.MINOR.PATCH`, numeric, each ≤ 65535, MAJOR ≥ 1 → [major, minor, patch]; otherwise null. */
export function parseReleaseVersion(v) {
  const m = typeof v === 'string' ? /^(\d+)\.(\d+)\.(\d+)$/.exec(v) : null
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some((n) => n > 65535) || parts[0] < 1) return null
  return parts
}

/** `extraMetadata.version` from the text of electron-builder.json5 (no json5 parser: one regex on that block). */
export function readReleaseVersion(json5Text) {
  const block = /"extraMetadata"\s*:\s*\{([^}]*)\}/.exec(json5Text)
  if (!block) return null
  const v = /"version"\s*:\s*"([^"]*)"/.exec(block[1])
  return v ? v[1] : null
}

/** Version of the last row of docs/store/submissions.md whose Result says the package was sent to the Store. */
export function lastSubmittedVersion(markdown) {
  if (typeof markdown !== 'string') return null
  const rows = markdown
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
  if (rows.length < 2) return null
  const header = rows[0].map((h) => h.toLowerCase())
  const vi = header.indexOf('version')
  const ri = header.indexOf('result')
  let last = null
  for (const row of rows.slice(1)) {
    if (row.every((c) => /^-+$/.test(c))) continue
    if (vi < 0 || ri < 0) continue
    if (SUBMITTED_RESULTS.has((row[ri] ?? '').toLowerCase()) && parseReleaseVersion(row[vi])) last = row[vi]
  }
  return last
}

/**
 * Pure check. Returns `{ errors: { code, field?, message }[] }`; codes and message shapes are those of
 * contracts/store-build.md. `allowPlaceholders` (used by `npm run check`) lets the three Partner Center values stay
 * placeholders but still checks every shape.
 */
export function checkStoreConfig({ identity, version, extensionsXml, submissionsMd, allowPlaceholders = false }) {
  const errors = []
  const shape = (field, value, rule) =>
    errors.push({ code: 'identity_shape', field, message: `appx.${field} ${JSON.stringify(value)} is not valid: ${rule}` })
  const id = identity ?? {}

  // Placeholders first; a placeholder field gets no shape check.
  const placeholderFields = new Set()
  for (const field of ALL_TEXT_FIELDS) {
    if (!isPlaceholder(id[field])) continue
    placeholderFields.add(field)
    if (allowPlaceholders && PARTNER_CENTER_FIELDS.includes(field)) continue
    errors.push({
      code: 'identity_placeholder',
      field,
      message: `appx.${field} is still a placeholder — copy it from Partner Center → Product identity`,
    })
  }
  const check = (field, ok, rule) => {
    if (placeholderFields.has(field)) return
    if (!ok(id[field])) shape(field, id[field], rule)
  }

  check('identityName', (v) => typeof v === 'string' && /^[A-Za-z0-9.-]{3,50}$/.test(v), '3–50 characters, only A–Z a–z 0–9 . -')
  check('publisher', (v) => typeof v === 'string' && /^CN=\S/.test(v), 'must start with "CN=" exactly as on Partner Center')
  check('publisherDisplayName', (v) => !isBlank(v), 'must not be empty')
  check(
    'applicationId',
    (v) =>
      typeof v === 'string' &&
      /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/.test(v) &&
      !RESERVED_APPLICATION_IDS.has(v.toUpperCase()),
    'letters / digits / periods, each part starts with a letter, not a reserved name (CON, PRN, AUX, NUL, COM1–9, LPT1–9)',
  )
  check('displayName', (v) => !isBlank(v), 'must not be empty (the name reserved in Partner Center)')
  check(
    'languages',
    (v) => Array.isArray(v) && v.length > 0 && v.every((l) => typeof l === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l)),
    'at least one language tag such as "en-US"; the first is the default',
  )
  check(
    'capabilities',
    (v) => Array.isArray(v) && v.length === 1 && v[0] === 'runFullTrust',
    'must be exactly ["runFullTrust"] (FR-004)',
  )
  check('addAutoLaunchExtension', (v) => v === false, 'must be false (the app declares its own startup task)')
  check('minVersion', (v) => typeof v === 'string' && WINDOWS_VERSION.test(v), 'four-part Windows build number such as "10.0.17763.0"')
  check('maxVersionTested', (v) => typeof v === 'string' && WINDOWS_VERSION.test(v), 'four-part Windows build number')
  if (WINDOWS_VERSION.test(id.minVersion ?? '') && WINDOWS_VERSION.test(id.maxVersionTested ?? '')) {
    if (compareWindowsVersions(id.minVersion, id.maxVersionTested) > 0)
      shape('minVersion', id.minVersion, `must not be greater than maxVersionTested ${id.maxVersionTested}`)
  }

  const parsed = parseReleaseVersion(version)
  if (!parsed) {
    errors.push({
      code: 'version_invalid',
      message: `Version ${JSON.stringify(version)} is not valid for the Store: use MAJOR.MINOR.PATCH with MAJOR ≥ 1 (the Store adds .0)`,
    })
  } else {
    const last = lastSubmittedVersion(submissionsMd)
    if (last && compareWindowsVersions(version, last) <= 0) {
      errors.push({
        code: 'version_not_increased',
        message: `Version ${version} is not greater than the last submitted ${last} (docs/store/submissions.md)`,
      })
    }
  }

  const xml = typeof extensionsXml === 'string' ? extensionsXml : ''
  const hasTask =
    /Category="windows\.startupTask"/.test(xml) && new RegExp(`<desktop:StartupTask\\b[^>]*TaskId="${STARTUP_TASK_ID}"`).test(xml)
  if (!hasTask) {
    errors.push({
      code: 'extensions_invalid',
      message: `appx-extensions.xml must declare the startup task ${STARTUP_TASK_ID}`,
    })
  }

  return { errors }
}

const readIfExists = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)

/** Reads the real files of the repository. */
export function loadStoreInputs(paths = PATHS) {
  const identity = JSON.parse(readFileSync(paths.identity, 'utf8'))
  return {
    identity,
    version: readReleaseVersion(readFileSync(paths.builderConfig, 'utf8')),
    extensionsXml: readIfExists(paths.extensions),
    submissionsMd: readIfExists(paths.submissions),
  }
}

function main(argv) {
  const allowPlaceholders = argv.includes('--allow-placeholders')
  if (argv.includes('--self-test')) {
    // Every negative test of the Store scripts (source/scripts/store/*.test.mjs): config, secrets, package rules, ….
    const tests = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(here, f))
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=dot', ...tests], { stdio: 'inherit' })
    if (r.status !== 0) {
      console.error('check-store-config: self-test failed')
      return 1
    }
  }
  const { errors } = checkStoreConfig({ ...loadStoreInputs(), allowPlaceholders })
  if (errors.length > 0) {
    console.error(`check-store-config: ${errors.length} problem(s), nothing built:`)
    for (const e of errors) console.error(`  [${e.code}] ${e.message}`)
    return 1
  }
  console.log(`check-store-config: OK${allowPlaceholders ? ' (placeholders allowed)' : ''}`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
