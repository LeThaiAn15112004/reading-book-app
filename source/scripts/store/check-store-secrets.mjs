// Spec 010 T014 — no signing secret is tracked by git (research R10, FR-013, SC-005).
//
//   node source/scripts/store/check-store-secrets.mjs [repoRoot]
//
// Fails (exit 1, every hit listed) on a tracked *.pfx / *.p12 file or a tracked text file that contains a PEM private
// key block. Untracked (ignored) files are not looked at: the test certificate lives outside the repository anyway.
// Cross-platform; part of `npm run check`.
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KEY_FILE = /\.(pfx|p12)$/i
// A real PEM private key block = the BEGIN line (PRIVATE / RSA PRIVATE / ENCRYPTED PRIVATE / EC PRIVATE …), a base64
// body of at least MIN_BODY_CHARS characters (optional "Name: value" headers allowed), and the matching END line.
// Prose that only names the header (docs, specs, this comment) is not a key and does not match.
const PEM_PRIVATE_KEY = /-----BEGIN ((?:[A-Z0-9]+ )*)PRIVATE KEY-----([\s\S]*?)-----END \1PRIVATE KEY-----/g
const BODY_LINE = /^(?:[A-Za-z0-9+/=]+|[A-Za-z-]+: .*)$/
const MIN_BODY_CHARS = 64
const MAX_SCAN_BYTES = 5 * 1024 * 1024

function trackedFiles(repoRoot) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return out.split('\0').filter(Boolean)
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

/** True when `text` contains a PEM private key block with a real base64 body. */
export function containsPrivateKey(text) {
  for (const m of text.matchAll(PEM_PRIVATE_KEY)) {
    const lines = m[2].split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0 || !lines.every((l) => BODY_LINE.test(l))) continue
    const base64 = lines.filter((l) => !l.includes(': ')).join('')
    if (base64.length >= MIN_BODY_CHARS) return true
  }
  return false
}

/** Returns `{ file, reason }[]` for every tracked secret in `repoRoot`. */
export function findTrackedSecrets(repoRoot) {
  const hits = []
  for (const rel of trackedFiles(repoRoot)) {
    if (KEY_FILE.test(rel)) {
      hits.push({ file: rel, reason: 'certificate / key container (.pfx / .p12)' })
      continue
    }
    const abs = path.join(repoRoot, rel)
    let size
    try {
      size = statSync(abs).size
    } catch {
      continue // deleted in the working tree
    }
    if (size === 0 || size > MAX_SCAN_BYTES) continue
    const buf = readFileSync(abs)
    if (looksBinary(buf)) continue
    if (containsPrivateKey(buf.toString('utf8'))) hits.push({ file: rel, reason: 'PEM private key block' })
  }
  return hits
}

function main(argv) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(argv[0] ?? path.join(here, '../../..'))
  const hits = findTrackedSecrets(repoRoot)
  if (hits.length > 0) {
    console.error(`check-store-secrets: ${hits.length} tracked secret(s) — remove them from git (and rotate the key):`)
    for (const h of hits) console.error(`  ${h.file}: ${h.reason}`)
    return 1
  }
  console.log('check-store-secrets: OK (no tracked .pfx / .p12 / private key)')
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
