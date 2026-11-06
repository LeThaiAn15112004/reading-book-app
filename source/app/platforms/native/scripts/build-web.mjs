#!/usr/bin/env node
// Builds the Mobile web UI from the shared UI in source/app/ and copies it to where the native local server module ships it.
// --feasibility: the M2 build with the fake host and sample books. --large also adds the 100 MB samples.
import { cpSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { writeFeasibilitySamples } from './feasibility-samples.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(appRoot, 'web-dist')
const shipped = path.join(appRoot, 'modules', 'local-server', 'ui-assets', 'web-ui')
const feasibility = process.argv.includes('--feasibility')

await build({
  // The repository root's vite.native.config.ts sets the Vite root (this folder) and the output (web-dist/).
  configFile: path.join(appRoot, '..', '..', '..', '..', 'vite.native.config.ts'),
  mode: feasibility ? 'feasibility' : 'production',
})

// The OFL requires the licence to travel with the fonts; Vite ships only the .ttf files it imports. Same files as
// Desktop's electron-builder `files`.
const fontNotices = path.join(appRoot, '..', 'electron', 'assets', 'fonts', 'typewriter')
for (const notice of ['OFL.txt', 'THIRD_PARTY_FONTS.md']) {
  cpSync(path.join(fontNotices, notice), path.join(dist, 'licenses', 'fonts', notice))
}

if (feasibility) {
  const samples = await writeFeasibilitySamples(
    path.join(dist, 'feasibility'),
    path.join(dist, 'spikes', 'spike-sample.epub'),
    { large: process.argv.includes('--large') },
  )
  console.log(`Feasibility samples: ${samples.map((sample) => sample.file).join(', ')}`)
}

rmSync(shipped, { recursive: true, force: true })
cpSync(dist, shipped, { recursive: true })
console.log(`Mobile web UI copied to ${path.relative(appRoot, shipped)}`)
