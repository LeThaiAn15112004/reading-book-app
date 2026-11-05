#!/usr/bin/env node
// Spec 009 FR-006, FR-007, FR-009 (T019): one install folder, one lock file, one manifest with dependencies.
//
//   node source/scripts/check-single-install.mjs
//
// Fails when the repository has a `node_modules`, `package-lock.json` or dependency-carrying `package.json` other than
// the root ones. Manifests that a tool needs and that declare no dependencies are allowed when listed in KEPT_MANIFESTS
// (with their reason); npm installs nothing for them. Generated native projects and build output are not scanned.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Manifests kept on purpose (spec 009 tasks T009): no dependencies, read by a tool. */
export const KEPT_MANIFESTS = {
  'source/apps/reading-book-desktop/package.json': 'Electron reads name / main (the name sets userData)',
  'source/apps/reading-book-mobile/package.json': 'kept until the Mobile host moves (US4); Expo now reads the root one',
  'source/apps/book-reader-sdk/package.json': 'linked as @reading-book/book-reader-sdk until US4 (T022)',
  'source/packages/config/package.json': 'linked as @reading-book/config until US4 (T022)',
}

const SKIP = new Set(['.git', 'android', 'ios', '.expo', 'dist', 'dist-electron', 'release', '.gradle', 'build', '.cxx'])
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

export function scan(root = repoRoot) {
  const found = { installs: [], locks: [], manifests: [] }
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(root, full).replaceAll('\\', '/')
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') {
          found.installs.push(rel)
          continue // never look inside an install folder
        }
        if (SKIP.has(entry.name)) continue
        walk(full)
      } else if (entry.name === 'package-lock.json') {
        found.locks.push(rel)
      } else if (entry.name === 'package.json') {
        found.manifests.push(rel)
      }
    }
  }
  walk(root)
  return found
}

export function checkSingleInstall(root = repoRoot) {
  const { installs, locks, manifests } = scan(root)
  const problems = []
  for (const dir of installs) if (dir !== 'node_modules') problems.push(`extra install folder: ${dir} (run npm run clean:old-installs)`)
  if (!existsSync(path.join(root, 'node_modules'))) problems.push('no install folder at the root: run npm install there')
  for (const file of locks) if (file !== 'package-lock.json') problems.push(`extra lock file: ${file}`)
  if (!locks.includes('package-lock.json')) problems.push('no package-lock.json at the root')
  for (const file of manifests) {
    if (file === 'package.json') continue
    const manifest = JSON.parse(readFileSync(path.join(root, file), 'utf8'))
    const deps = DEP_FIELDS.filter((f) => Object.keys(manifest[f] ?? {}).length > 0)
    if (deps.length) problems.push(`${file} declares ${deps.join(', ')}: dependencies belong in the root package.json`)
    else if (!(file in KEPT_MANIFESTS)) problems.push(`${file}: a manifest that is not listed in KEPT_MANIFESTS`)
  }
  return { problems, installs, locks, manifests }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { problems, manifests } = checkSingleInstall()
  if (problems.length) {
    console.error(`check:single-install: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`check:single-install: 1 install folder, 1 lock file, ${manifests.length} manifest(s) (root + ${manifests.length - 1} kept without dependencies)`)
}
