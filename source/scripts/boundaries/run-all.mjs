#!/usr/bin/env node
// `npm run check:boundaries` (spec 008 T035, re-based by spec 009 T050): every boundary check, then the negative tests
// that prove each check fails on its probes. R9 (window.api) and R12 (suffix imports) are also ESLint rules, so they
// run with lint; their tests run here. R1 is the core tsconfig (tested here); R4 is retired.
// Exceptions are listed in exceptions.json.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const steps = [
  ['R2, R3  core imports', ['check-sdk-imports.mjs']],
  ['R6, R7, R8, R11, R12  app imports', ['check-app-imports.mjs']],
  ['R8  Mobile UI bundle graph', ['check-mobile-ui-graph.mjs']],
  ['R5  area graph', ['check-workspace-graph.mjs']],
  ['FR-033  no secrets in bundles', ['check-no-secrets.mjs']],
  ['negative tests', ['--test', '--test-reporter=spec', 'boundaries.test.mjs']],
]

let failed = 0
for (const [name, args] of steps) {
  console.log(`\n== ${name}`)
  const out = spawnSync(process.execPath, args, { cwd: here, stdio: 'inherit' })
  if (out.status !== 0) {
    failed++
    console.error(`!! ${name} failed`)
  }
}
console.log(failed ? `\ncheck:boundaries: ${failed} of ${steps.length} failed` : `\ncheck:boundaries: all ${steps.length} passed`)
process.exit(failed ? 1 : 0)
