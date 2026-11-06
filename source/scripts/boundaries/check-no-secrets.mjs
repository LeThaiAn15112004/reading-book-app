#!/usr/bin/env node
// FR-033 (spec 008): no OAuth secret file enters a Desktop or Mobile bundle.
//   1. No file named like a git-ignored secret file exists in any bundle output.
//   2. When the secret files exist locally (they never do in CI), none of their secret values, and none of their
//      raw contents, appears in any output file. Values are never printed.
// Outputs: Desktop `dist/`, `dist-electron/`, packaged `release/**` (including app.asar); Mobile `web/dist/` and the
// shipped copy in `modules/local-server/ui-assets/`. An output that has not been built is reported, not failed.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { configDir, desktopDir, isMain, mobileDir, rel } from './lib/imports.mjs'

/** The git-ignored secret files (root `.gitignore`: `client_secret_*.json`, `cloud-oauth-secrets.json`). */
export const SECRET_FILE_PATTERNS = [/^client_secret_.*\.json$/i, /^cloud-oauth-secrets\.json$/i]
const isSecretFileName = (name) => SECRET_FILE_PATTERNS.some((re) => re.test(name))

export const DEFAULT_OUTPUTS = [
  path.join(desktopDir, 'dist'),
  path.join(desktopDir, 'dist-electron'),
  path.join(desktopDir, 'release'),
  path.join(mobileDir, 'web-dist'),
  path.join(mobileDir, 'modules/local-server/ui-assets'),
]

/** Secret strings of a secret file: values under keys containing "secret", at least 8 characters. */
export function secretValues(json) {
  const out = []
  const walk = (value, key = '') => {
    if (typeof value === 'string') {
      if (/secret/i.test(key) && value.trim().length >= 8) out.push(value.trim())
    } else if (Array.isArray(value)) value.forEach((v) => walk(v, key))
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k)
  }
  walk(json)
  return out
}

function filesUnder(dir) {
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(dir)
  return out
}

export function checkNoSecrets({ secretsDir = configDir, outputs = DEFAULT_OUTPUTS } = {}) {
  const problems = []
  const notes = []
  const secretFiles = existsSync(secretsDir) ? readdirSync(secretsDir).filter(isSecretFileName).map((f) => path.join(secretsDir, f)) : []
  const needles = []
  for (const file of secretFiles) {
    const raw = readFileSync(file)
    needles.push({ source: path.basename(file), bytes: raw, kind: 'file contents' })
    try {
      for (const value of secretValues(JSON.parse(raw.toString('utf8')))) needles.push({ source: path.basename(file), bytes: Buffer.from(value), kind: 'a secret value' })
    } catch {
      notes.push(`${path.basename(file)} is not JSON; only its raw contents are searched`)
    }
  }
  notes.push(secretFiles.length ? `${secretFiles.length} local secret file(s) found; their values are searched for` : 'no local secret files (as in CI); only file names are checked')

  for (const out of outputs) {
    if (!existsSync(out) || !statSync(out).isDirectory()) {
      notes.push(`${rel(out)} not built; skipped`)
      continue
    }
    const files = filesUnder(out)
    for (const file of files) {
      if (isSecretFileName(path.basename(file))) problems.push(`${rel(file)}: a secret file is in the bundle output`)
      if (needles.length === 0) continue
      const size = statSync(file).size
      if (size === 0) continue
      const content = readFileSync(file)
      for (const needle of needles) {
        if (needle.bytes.length && content.includes(needle.bytes)) problems.push(`${rel(file)}: contains ${needle.kind} of ${needle.source}`)
      }
    }
    notes.push(`${rel(out)}: ${files.length} files checked`)
  }
  return { problems, notes }
}

if (isMain(import.meta.url)) {
  const { problems, notes } = checkNoSecrets()
  for (const n of notes) console.log(`note: ${n}`)
  for (const p of problems) console.error(`[FR-033] ${p}`)
  console.log(problems.length ? `check-no-secrets: ${problems.length} problem(s)` : 'check-no-secrets: OK')
  if (problems.length) process.exitCode = 1
}
