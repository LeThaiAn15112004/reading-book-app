#!/usr/bin/env node
// Loads Main's externals with the PACKAGED Electron from a copy of the build OUTSIDE the repository.
//
//   node source/scripts/check-packaged-runtime.mjs path/to/win-unpacked/resources/app.asar
//
// Why outside the repo: release/<version>/win-unpacked lives inside the repository, so when a package is missing from
// app.asar Node walks up the folders and finds it in the repo's own node_modules — the build "works" here and fails
// once installed (2026-11-10: the Store app could not load @huggingface/transformers, "Cannot find package 'semver'
// imported from …/sharp/dist/libvips.mjs"). The copy goes to the OS temp folder, which has no node_modules above it.
//
// The packaged exe runs in ELECTRON_RUN_AS_NODE mode (Node with Electron's ABI and asar support; no window, no user
// data) and imports exactly the entry points Main imports. Windows builds only (win-unpacked); skipped elsewhere.
// `check-desktop-package.mjs` calls it after its static checks.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The entry points Main imports (vite.config.ts externals; see `MAIN_EXTERNALS` in desktop-package-deps.mjs). */
export const MAIN_ENTRY_POINTS = [
  '@huggingface/transformers', // loads sharp + onnxruntime-node (the translation engine)
  'sharp',
  'onnxruntime-node',
  'better-sqlite3',
  'music-metadata',
  'pdfjs-dist/legacy/build/pdf.mjs',
]

const PROBE = `
const { createRequire } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const [resources, ...specifiers] = process.argv.slice(2)
// Resolve as if from Main's bundle inside the asar.
const fromMain = createRequire(path.join(resources, 'app.asar', 'source/app/platforms/electron/dist-electron/main.js'))
;(async () => {
  const results = []
  for (const specifier of specifiers) {
    try {
      let resolved
      try { resolved = fromMain.resolve(specifier) } catch { resolved = null }
      if (resolved) await import(pathToFileURL(resolved).href)
      else await import(specifier)
      results.push({ specifier, ok: true })
    } catch (error) {
      results.push({ specifier, ok: false, error: String(error && (error.message || error)).split('\\n')[0] })
    }
  }
  process.stdout.write('@@RESULT@@' + JSON.stringify(results) + '\\n')
  process.exit(0)
})()
`

/** @returns {{ skipped?: string, ok?: boolean, loaded?: string[], errors?: string[] }} */
export function checkPackagedRuntime(asar, { entryPoints = MAIN_ENTRY_POINTS, timeoutMs = 180_000 } = {}) {
  const resources = path.dirname(asar)
  const unpacked = path.dirname(resources)
  if (process.platform !== 'win32') return { skipped: 'Windows builds only' }
  if (path.basename(unpacked) !== 'win-unpacked') return { skipped: `${unpacked} is not a win-unpacked folder` }
  const exe = readdirSync(unpacked).find((f) => f.toLowerCase().endsWith('.exe') && !/^(elevate|uninstall)/i.test(f))
  if (!exe) return { skipped: `no app .exe in ${unpacked}` }

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'readmate-packaged-runtime-'))
  try {
    const copy = path.join(tmp, 'app')
    cpSync(unpacked, copy, { recursive: true })
    const probe = path.join(tmp, 'probe.cjs')
    writeFileSync(probe, PROBE)
    const r = spawnSync(path.join(copy, exe), [probe, path.join(copy, 'resources'), ...entryPoints], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: '' },
      cwd: tmp,
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      shell: false,
    })
    const line = (r.stdout ?? '').split(/\r?\n/).find((l) => l.startsWith('@@RESULT@@'))
    if (!line) {
      return { ok: false, loaded: [], errors: [`probe produced no result (status ${r.status}, ${r.error?.message ?? 'no error'}): ${(r.stderr ?? '').trim().slice(0, 500)}`] }
    }
    const results = JSON.parse(line.slice('@@RESULT@@'.length))
    const errors = results.filter((x) => !x.ok).map((x) => `${x.specifier}: ${x.error}`)
    return { ok: errors.length === 0, loaded: results.filter((x) => x.ok).map((x) => x.specifier), errors }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const asar = process.argv[2]
  if (!asar || !existsSync(asar)) {
    console.error('usage: node source/scripts/check-packaged-runtime.mjs path/to/win-unpacked/resources/app.asar')
    process.exit(1)
  }
  const result = checkPackagedRuntime(path.resolve(asar))
  if (result.skipped) console.log(`skipped: ${result.skipped}`)
  else if (result.ok) console.log(`✓ loaded outside the repo: ${result.loaded.join(', ')}`)
  else {
    console.error('✗ not loadable outside the repo:')
    for (const e of result.errors) console.error(`  ${e}`)
  }
  process.exit(result.ok || result.skipped ? 0 : 1)
}
