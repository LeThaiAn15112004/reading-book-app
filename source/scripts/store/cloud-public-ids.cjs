// Spec 010 KL-1 — the OAuth client values that the Store package carries, so Google Drive, Dropbox and OneDrive
// sign-in work in the installed app (docs/implementation_plan/msix_store_packaging.md "Known limitations").
//
// Four values, all public by design for an app installed on the user's machine:
//   - dropboxAppKey       Dropbox "App key" (authorization code + PKCE; the Dropbox app SECRET is NEVER read here)
//   - onedriveClientId    Microsoft Entra ID "Application (client) ID" of a public client (PKCE)
//   - googleClientId      Google OAuth client ID of a "Desktop app" client
//   - googleClientSecret  that Desktop client's client_secret. Decision 2026-11-09: Google does not treat the secret
//                         of an installed-app client as confidential (https://developers.google.com/identity/protocols/oauth2/native-app),
//                         so it is embedded. Only an `installed` client file is accepted: a `web` client's secret IS
//                         confidential and stops the build.
//
// Source, per value: the build environment (DROPBOX_APP_KEY / AZURE_CLIENT_ID / GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET,
// the names Main falls back to at run time), else the maintainer's git-ignored files in source/core/src/config:
// cloud-oauth-secrets.json (Dropbox, OneDrive) and client_secret_*.json (Google; the first by name, as Main picks it).
// Each value is checked against its format and against every OTHER secret known locally, so a secret pasted in the
// wrong field (e.g. the Dropbox app secret) stops the build instead of shipping.
//
// Used by electron-builder.store.cjs (extraMetadata.readmateCloudOAuth → app.asar/package.json, read by Main in
// config/cloud-oauth-config.ts) and by package-store.mjs (stops before building on an error; reads the values back
// from the built app.asar). CommonJS because electron-builder.store.cjs requires it.
'use strict'
const { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '../../..')
const CONFIG_DIR = path.join(repoRoot, 'source/core/src/config')
const SECRETS_FILE = path.join(CONFIG_DIR, 'cloud-oauth-secrets.json')
const GOOGLE_FILE_PATTERN = /^client_secret_.*\.json$/i
const GOOGLE_SOURCE = 'client_secret_*.json (Desktop app client)'

/** The package.json key Main reads (config/cloud-availability-core.mjs embeddedPublicIdsFrom). */
const EMBEDDED_KEY = 'readmateCloudOAuth'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One row per embedded value. Nothing else can be embedded (verifyEmbedded rejects any other key).
 * `file` = path in cloud-oauth-secrets.json; `google` = field of the `installed` object of client_secret_*.json.
 * `ownSecret` = the secret origins that ARE this value (excluded from its own "equals a secret" check).
 */
const PUBLIC_IDS = [
  { key: 'dropboxAppKey', label: 'Dropbox app key', env: 'DROPBOX_APP_KEY', file: ['dropbox', 'appKey'], pattern: /^[a-z0-9]{8,32}$/ },
  { key: 'onedriveClientId', label: 'Microsoft Entra ID client ID', env: 'AZURE_CLIENT_ID', file: ['onedrive', 'clientId'], pattern: GUID },
  { key: 'googleClientId', label: 'Google client ID', env: 'GOOGLE_CLIENT_ID', google: 'client_id', pattern: /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/ },
  {
    key: 'googleClientSecret',
    label: 'Google client secret (Desktop app client, public by Google policy)',
    env: 'GOOGLE_CLIENT_SECRET',
    google: 'client_secret',
    pattern: /^[A-Za-z0-9_-]{16,64}$/,
    ownSecret: ['env GOOGLE_CLIENT_SECRET', 'google client_secret'],
  },
]

/**
 * Secret strings known locally, with where each came from: values under keys containing "secret" in
 * cloud-oauth-secrets.json, the Google client's client_secret, and *_SECRET variables.
 */
function knownSecrets(secretsJson, googleClient, env) {
  const out = []
  const walk = (value, key, at) => {
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k, at ? `${at}.${k}` : k)
    else if (typeof value === 'string' && /secret/i.test(key) && value.trim()) out.push({ value: value.trim(), origin: `file ${at}` })
  }
  if (secretsJson) walk(secretsJson, '', '')
  if (typeof googleClient?.client_secret === 'string' && googleClient.client_secret.trim()) {
    out.push({ value: googleClient.client_secret.trim(), origin: 'google client_secret' })
  }
  for (const [k, v] of Object.entries(env ?? {})) {
    if (/secret/i.test(k) && typeof v === 'string' && v.trim()) out.push({ value: v.trim(), origin: `env ${k.toUpperCase()}` })
  }
  return out
}

/** The maintainer's local secrets file as JSON; null when absent (CI). An unreadable file is an error. */
function readSecretsFile(file = SECRETS_FILE) {
  if (!existsSync(file)) return { json: null, error: null }
  try {
    return { json: JSON.parse(readFileSync(file, 'utf8')), error: null }
  } catch (err) {
    return { json: null, error: { code: 'cloud_secrets_unreadable', message: `${path.basename(file)} is not valid JSON (${err.message})` } }
  }
}

/**
 * The `installed` object of the first client_secret_*.json in `dir` (Main picks the same file); null when there is
 * none (CI). A file that is not JSON, or a `web` client (its secret is confidential), is an error.
 */
function readGoogleClientFile(dir = CONFIG_DIR) {
  if (!existsSync(dir)) return { client: null, error: null }
  const name = readdirSync(dir).filter((n) => GOOGLE_FILE_PATTERN.test(n)).sort()[0]
  if (!name) return { client: null, error: null }
  let json
  try {
    json = JSON.parse(readFileSync(path.join(dir, name), 'utf8'))
  } catch (err) {
    return { client: null, error: { code: 'cloud_secrets_unreadable', message: `client_secret_*.json is not valid JSON (${err.message})` } }
  }
  return googleClientFrom(json)
}

/** `{ client, error }` from a parsed client_secret_*.json: only a Desktop ("installed") client may be embedded. */
function googleClientFrom(json) {
  if (json?.installed && typeof json.installed === 'object') return { client: json.installed, error: null }
  return {
    client: null,
    error: {
      code: 'google_client_not_desktop',
      message: 'client_secret_*.json is not a "Desktop app" OAuth client (no "installed" object); a web client secret is confidential and is never embedded',
    },
  }
}

/**
 * Resolves the embedded values → `{ ids, sources, errors }`. `ids` holds only values that passed every check, so the
 * electron-builder config can embed it as is even when there are errors (package-store stops on errors first).
 * Error codes: cloud_id_missing, cloud_id_invalid, cloud_id_is_secret, cloud_secrets_unreadable,
 * google_client_not_desktop, google_pair_mixed.
 * Tests pass `secrets` (cloud-oauth-secrets.json content) and `google` (client_secret_*.json content); `null` = absent.
 */
function resolveCloudPublicIds({ env = process.env, secretsFile = SECRETS_FILE, configDir = CONFIG_DIR, secrets, google } = {}) {
  const errors = []
  let json = secrets ?? null
  if (secrets === undefined) {
    const read = readSecretsFile(secretsFile)
    json = read.json
    if (read.error) errors.push(read.error)
  }
  let googleClient = null
  const googleRead = google === undefined ? readGoogleClientFile(configDir) : google === null ? { client: null, error: null } : googleClientFrom(google)
  googleClient = googleRead.client
  if (googleRead.error) errors.push(googleRead.error)

  const envOf = (name) => (typeof env?.[name] === 'string' ? env[name].trim() : '')
  // The Google pair comes from ONE place: both variables, or the file. One variable alone would pair an ID with
  // another client's secret.
  const googleFromEnv = Boolean(envOf('GOOGLE_CLIENT_ID') && envOf('GOOGLE_CLIENT_SECRET'))
  if (!googleFromEnv && (envOf('GOOGLE_CLIENT_ID') || envOf('GOOGLE_CLIENT_SECRET'))) {
    errors.push({ code: 'google_pair_mixed', message: 'set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither (then client_secret_*.json is used)' })
  }

  const secretValues = knownSecrets(json, googleClient, env)
  const ids = {}
  const sources = {}
  for (const row of PUBLIC_IDS) {
    let value = ''
    let source = ''
    if (row.google) {
      if (googleFromEnv) {
        value = envOf(row.env)
        source = `env ${row.env}`
      } else if (!envOf('GOOGLE_CLIENT_ID') && !envOf('GOOGLE_CLIENT_SECRET') && typeof googleClient?.[row.google] === 'string') {
        value = googleClient[row.google].trim()
        source = GOOGLE_SOURCE
      }
      if (!value) {
        if (!googleRead.error && !errors.some((e) => e.code === 'google_pair_mixed')) {
          errors.push({ code: 'cloud_id_missing', message: `${row.label} not set: set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET or add a Desktop app client_secret_*.json` })
        }
        continue
      }
    } else {
      const fromEnv = envOf(row.env)
      const fromFile = row.file.reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), json)
      value = fromEnv || (typeof fromFile === 'string' ? fromFile.trim() : '')
      source = fromEnv ? `env ${row.env}` : 'cloud-oauth-secrets.json'
      if (!value) {
        errors.push({ code: 'cloud_id_missing', message: `${row.label} not set: set ${row.env} or "${row.file.join('.')}" in cloud-oauth-secrets.json` })
        continue
      }
    }
    const own = new Set(row.ownSecret ?? [])
    if (secretValues.some((s) => s.value === value && !own.has(s.origin))) {
      errors.push({ code: 'cloud_id_is_secret', message: `${row.label} (${source}) equals another client SECRET; that value may not be embedded` })
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

module.exports = { EMBEDDED_KEY, PUBLIC_IDS, SECRETS_FILE, CONFIG_DIR, resolveCloudPublicIds, verifyEmbedded, readAsarFile }
