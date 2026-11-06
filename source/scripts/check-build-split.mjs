#!/usr/bin/env node
// Spec 009 FR-010a (T046, contracts/platform-adapters.md rule 4): a Desktop renderer build contains no `.native` module
// and the Mobile WebView build no `.electron` module. Both are built once with source maps into a temporary folder
// (the real `dist/` folders are not touched) and the module list of every source map is read.
//
//   node source/scripts/check-build-split.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const desktopDir = path.join(repoRoot, 'source/apps/reading-book-desktop')
const mobileWebDir = path.join(repoRoot, 'source/apps/reading-book-mobile/web')
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function build(cwd, outDir) {
  const r = spawnSync(npx, ['vite', 'build', '--sourcemap', '--outDir', outDir, '--emptyOutDir'], { cwd, encoding: 'utf8', shell: process.platform === 'win32' })
  if (r.status !== 0) throw new Error(`vite build failed in ${cwd}\n${r.stdout}\n${r.stderr}`)
}

function moduleList(dir) {
  const sources = new Set()
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js.map')) {
        for (const s of JSON.parse(readFileSync(full, 'utf8')).sources) sources.add(s.replaceAll('\\', '/'))
      }
    }
  }
  walk(dir)
  return [...sources]
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'build-split-'))
let failed = false
try {
  const report = (name, dir, forbidden, label) => {
    const modules = moduleList(dir)
    const hits = modules.filter((m) => forbidden.test(m))
    console.log(`${name}: ${modules.length} modules, ${hits.length} ${label}${hits.length ? `: ${hits.join(', ')}` : ''}`)
    if (hits.length) failed = true
    return modules
  }
  build(desktopDir, path.join(tmp, 'desktop'))
  build(mobileWebDir, path.join(tmp, 'web'))
  const desktop = report('Desktop renderer', path.join(tmp, 'desktop'), /\.native\.tsx?$/, '.native modules')
  const web = report('Mobile WebView', path.join(tmp, 'web'), /\.electron\.tsx?$/, '.electron modules')
  // Sanity: each build does contain its own side, so a zero above is not an empty scan.
  const own = (modules, re) => modules.filter((m) => re.test(m)).length
  console.log(`  own side: Desktop ${own(desktop, /\.electron\.tsx?$/)} .electron, WebView ${own(web, /\.native\.tsx?$/)} .native`)
  if (own(desktop, /\.electron\.tsx?$/) === 0 || own(web, /\.native\.tsx?$/) === 0) {
    console.error('check-build-split: a build holds none of its own adapters, so the scan proves nothing')
    failed = true
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
if (failed) process.exitCode = 1
else console.log('check-build-split: OK')
