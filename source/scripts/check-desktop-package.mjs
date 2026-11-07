#!/usr/bin/env node
// Spec 009 FR-017 (T052): the Desktop package contains no Mobile code.
//
//   node source/scripts/check-desktop-package.mjs [path/to/app.asar]
//
// Without an argument, every `resources/app.asar` under the newest `source/app/platforms/electron/release/<version>/`
// is checked (win-unpacked, linux-unpacked, mac/*.app). The asar index (and `app.asar.unpacked`) is listed and the
// check fails when any path is React Native / Expo code or comes from `source/app/platforms/native`, or when what Main
// needs at run time (its entry, the renderer, the externals of vite.config.ts) is missing. `npm run package` runs it
// after electron-builder.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const RELEASE_DIR = path.join(repoRoot, 'source/app/platforms/electron/release')
const HOST = 'source/app/platforms/electron'

/** Package names (any `node_modules/<name>` segment) that belong to Mobile only. */
const FORBIDDEN_PACKAGE = [/^react-native(-|$)/, /^expo(-|$)/, /^@expo$/, /^@react-native(-|$)/, /^@react-native-community$/]

/** Paths every Desktop package must contain. */
export const REQUIRED = [
  'package.json',
  `${HOST}/package.json`,
  `${HOST}/dist-electron/main.js`,
  `${HOST}/dist-electron/preload.mjs`,
  `${HOST}/dist/index.html`,
  'node_modules/better-sqlite3/package.json',
  'node_modules/music-metadata/package.json',
  'node_modules/pdfjs-dist/package.json',
  'node_modules/@huggingface/transformers/package.json',
]

/** The reason a packaged path is not allowed, or null. */
export function forbiddenReason(file) {
  const p = file.replaceAll('\\', '/').replace(/^\/+/, '')
  if (p.includes('platforms/native/')) return 'Mobile host code (source/app/platforms/native)'
  if (/(^|\/)[^/]+\.native\.[cm]?[jt]sx?$/.test(p)) return 'a .native platform adapter'
  const segments = p.split('/')
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] !== 'node_modules') continue
    const name = segments[i + 1]
    if (FORBIDDEN_PACKAGE.some((re) => re.test(name))) return `Mobile-only package "${name}"`
  }
  return null
}

/** Checks a list of packaged paths: forbidden entries and missing required ones. */
export function checkPackagedPaths(paths) {
  const set = new Set(paths.map((p) => p.replaceAll('\\', '/').replace(/^\/+/, '')))
  const forbidden = []
  for (const p of set) {
    const reason = forbiddenReason(p)
    if (reason) forbidden.push({ path: p, reason })
  }
  const missing = REQUIRED.filter((p) => !set.has(p))
  return { forbidden, missing, count: set.size }
}

/** Every file path stored in an asar archive (its JSON header; file contents are not read). */
export function listAsar(file) {
  const buf = readFileSync(file)
  // Header: UInt32 4 | UInt32 header pickle size | UInt32 payload size | UInt32 JSON length | JSON
  const jsonLength = buf.readUInt32LE(12)
  const header = JSON.parse(buf.subarray(16, 16 + jsonLength).toString('utf8'))
  const out = []
  const walk = (node, prefix) => {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const rel = prefix ? `${prefix}/${name}` : name
      if (entry.files) walk(entry, rel)
      else out.push(rel)
    }
  }
  walk(header, '')
  return out
}

function listDir(dir, prefix = '') {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...listDir(path.join(dir, entry.name), rel))
    else out.push(rel)
  }
  return out
}

function findAsars() {
  if (!existsSync(RELEASE_DIR)) return []
  const versions = readdirSync(RELEASE_DIR)
    .map((name) => path.join(RELEASE_DIR, name))
    .filter((p) => statSync(p).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (versions.length === 0) return []
  const found = []
  const walk = (dir, depth) => {
    if (depth > 6) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.endsWith('.asar.unpacked') || entry.name === 'node_modules') continue
        walk(full, depth + 1)
      } else if (entry.name === 'app.asar' && ['resources', 'Resources'].includes(path.basename(dir))) {
        found.push(full)
      }
    }
  }
  walk(versions[0], 0)
  return found
}

function checkAsar(asar) {
  const files = [...listAsar(asar), ...listDir(`${asar}.unpacked`)]
  // Anything else in resources/ (FFmpeg, …) is checked for Mobile code too.
  const resources = path.dirname(asar)
  const extra = listDir(resources).filter((p) => !p.startsWith('app.asar')).map((p) => `../${p}`)
  const result = checkPackagedPaths(files)
  for (const p of extra) {
    const reason = forbiddenReason(p)
    if (reason) result.forbidden.push({ path: p, reason })
  }
  return result
}

function main() {
  const arg = process.argv[2]
  const asars = arg ? [path.resolve(arg)] : findAsars()
  if (asars.length === 0) {
    console.error(`check-desktop-package: no app.asar found under ${path.relative(repoRoot, RELEASE_DIR)} — run electron-builder first`)
    process.exit(1)
  }
  let failed = false
  for (const asar of asars) {
    const { forbidden, missing, count } = checkAsar(asar)
    const label = path.relative(repoRoot, asar)
    if (forbidden.length === 0 && missing.length === 0) {
      console.log(`✓ ${label}: ${count} files, no Mobile code, Main's entry and externals present`)
      continue
    }
    failed = true
    console.error(`✗ ${label}`)
    for (const f of forbidden.slice(0, 50)) console.error(`  forbidden: ${f.path} — ${f.reason}`)
    if (forbidden.length > 50) console.error(`  … and ${forbidden.length - 50} more forbidden paths`)
    for (const m of missing) console.error(`  missing: ${m}`)
  }
  if (failed) process.exit(1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
