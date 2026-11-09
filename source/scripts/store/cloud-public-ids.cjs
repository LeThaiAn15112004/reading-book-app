// Spec 010 KL-1 — the PUBLIC OAuth client identifiers that the Store package carries, so Dropbox and OneDrive sign-in
// work in the installed app (docs/implementation_plan/msix_store_packaging.md "Known limitations").
//
// Only two values, both public by design in an authorization-code + PKCE flow without a client secret:
//   - dropboxAppKey     (Dropbox "App key"; the app secret is NEVER read here)
//   - onedriveClientId  (Microsoft Entra ID "Application (client) ID" of a public client)
// Google Drive is not embedded: its Desktop client needs a client secret, and FR-033 forbids secret values in a bundle.
//
// Source, per value: the build environment (DROPBOX_APP_KEY / AZURE_CLIENT_ID, the same names Main falls back to at
// run time), else the maintainer's git-ignored source/core/src/config/cloud-oauth-secrets.json. Each value is checked
// against its format and against every secret value known locally, so a secret pasted in the wrong field stops the
// build instead of shipping.
//
// Used by electron-builder.store.cjs (extraMetadata.readmateCloudOAuth → app.asar/package.json, read by Main in
// config/cloud-oauth-config.ts) and by package-store.mjs (stops before building on an error; reads the value back
// from the built app.asar). CommonJS because electron-builder.store.cjs requires it.
'use strict'
const { closeSync, existsSync, openSync, readFileSync, readSync } = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '../../..')
const SECRETS_FILE = path.join(repoRoot, 'source/core/src/config/cloud-oauth-secrets.json')

/** The package.json key Main reads (config/cloud-oauth-config.ts EMBEDDED_KEY). */
const EMBEDDED_KEY = 'readmateCloudOAuth'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One row per embedded value. Nothing else can be embedded (verifyEmbedded rejects any other key). */
const PUBLIC_IDS = [
  { key: 'dropboxAppKey', label: 'Dropbox app key', env: 'DROPBOX_APP_KEY', file: ['dropbox', 'appKey'], pattern: /^[a-z0-9]{8,32}$/ },
  { key: 'onedriveClientId', label: 'Microsoft Entra ID client ID', env: 'AZURE_CLIENT_ID', file: ['onedrive', 'clientId'], pattern: GUID },
]

/** Secret strings known locally: values under keys containing "secret" in the secrets file, and *_SECRET variables. */
function knownSecrets(secretsJson, env) {
  const out = []
  const walk = (value, key) => {
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k)
    else if (typeof value === 'string' && /secret/i.test(key) && value.trim()) out.push(value.trim())
  }
  if (secretsJson) walk(secretsJson, '')
  for (const [k, v] of Object.entries(env ?? {})) if (/secret/i.test(k) && typeof v === 'string' && v.trim()) out.push(v.trim())
  return out
}

/** The maintainer's local secrets file as JSON; null when absent (CI). An unreadable file is an error. */
function readSecretsFile(file = SECRETS_FILE) {
  if (!existsSync(file)) return { json: null, error: null }
  try {
    return { json: JSON.parse(readFileSync(file, 'utf8')), error: null }
  } catch (err) {
    return { json: null, error: `${path.basename(file)} is not valid JSON (${err.message})` }
  }
}

/**
 * Resolves the public IDs → `{ ids, sources, errors }`. `ids` holds only values that passed every check, so the
 * electron-builder config can embed it as is even when there are errors (package-store stops on errors first).
 * Error codes: cloud_id_missing, cloud_id_invalid, cloud_id_is_secret, cloud_secrets_unreadable.
 */
function resolveCloudPublicIds({ env = process.env, secretsFile = SECRETS_FILE, secrets } = {}) {
  const errors = []
  let json = secrets ?? null
  if (secrets === undefined) {
    const read = readSecretsFile(secretsFile)
    json = read.json
    if (read.error) errors.push({ code: 'cloud_secrets_unreadable', message: read.error })
  }
  const secretValues = knownSecrets(json, env)
  const ids = {}
  const sources = {}
  for (const row of PUBLIC_IDS) {
    const fromEnv = typeof env?.[row.env] === 'string' ? env[row.env].trim() : ''
    const fromFile = row.file.reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), json)
    const value = fromEnv || (typeof fromFile === 'string' ? fromFile.trim() : '')
    const source = fromEnv ? `env ${row.env}` : 'cloud-oauth-secrets.json'
    if (!value) {
      errors.push({ code: 'cloud_id_missing', message: `${row.label} not set: set ${row.env} or "${row.file.join('.')}" in cloud-oauth-secrets.json` })
      continue
    }
    if (secretValues.includes(value)) {
      errors.push({ code: 'cloud_id_is_secret', message: `${row.label} (${source}) equals a client SECRET; only the public identifier may be embedded` })
      continue
    }
    if (!row.pattern.test(value)) {
      errors.push({ code: 'cloud_id_invalid', message: `${row.label} (${source}) does not look like one (expected ${row.pattern})` })
      continue
    }
    ids[row.key] = value
    sources[row.key] = source
  }
  return { ids, sources, errors }
}

/** Checks the `readmateCloudOAuth` object found in the built package.json → list of problems (empty = OK). */
function verifyEmbedded(pkgJson, expectedIds) {
  const problems = []
  const embedded = pkgJson?.[EMBEDDED_KEY]
  if (!embedded || typeof embedded !== 'object') return [`package.json has no "${EMBEDDED_KEY}" object`]
  const allowed = new Set(PUBLIC_IDS.map((r) => r.key))
  for (const key of Object.keys(embedded)) if (!allowed.has(key)) problems.push(`unexpected key "${key}" in ${EMBEDDED_KEY}`)
  for (const row of PUBLIC_IDS) {
    if (embedded[row.key] !== expectedIds[row.key]) problems.push(`${row.key} in the package is not the resolved ${row.label}`)
  }
  return problems
}

/** Reads one file out of an asar archive without loading the whole archive (header layout as listAsar). */
function readAsarFile(asarFile, rel) {
  const fd = openSync(asarFile, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const headerPickleSize = head.readUInt32LE(4)
    const jsonLength = head.readUInt32LE(12)
    const json = Buffer.alloc(jsonLength)
    readSync(fd, json, 0, jsonLength, 16)
    let node = JSON.parse(json.toString('utf8'))
    for (const part of rel.split('/')) node = node?.files?.[part]
    if (!node || node.files || node.unpacked) throw new Error(`${rel} is not a packed file in ${asarFile}`)
    const out = Buffer.alloc(node.size)
    readSync(fd, out, 0, node.size, 8 + headerPickleSize + Number(node.offset))
    return out
  } finally {
    closeSync(fd)
  }
}

module.exports = { EMBEDDED_KEY, PUBLIC_IDS, SECRETS_FILE, resolveCloudPublicIds, verifyEmbedded, readAsarFile }
