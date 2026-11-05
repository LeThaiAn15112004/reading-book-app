#!/usr/bin/env node
// Spec 009 FR-020 (T020): remove what an older checkout installed per folder, so the root install is the only one.
//
//   npm run clean:old-installs            # remove
//   npm run clean:old-installs -- --dry   # list only
//
// Removes every `node_modules` and `package-lock.json` below the root (never the root ones, never anything else).
// A folder another program holds open (an IDE's Gradle import, a running dev server) is reported, not forced.
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scan } from './check-single-install.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dry = process.argv.includes('--dry')
const { installs, locks } = scan(repoRoot)
const targets = [...installs.filter((d) => d !== 'node_modules'), ...locks.filter((f) => f !== 'package-lock.json')]

if (targets.length === 0) {
  console.log('clean:old-installs: nothing to remove')
  process.exit(0)
}

const failed = []
for (const rel of targets) {
  if (dry) {
    console.log(`would remove ${rel}`)
    continue
  }
  try {
    rmSync(path.join(repoRoot, rel), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    console.log(`removed ${rel}`)
  } catch (error) {
    failed.push(`${rel}: ${error.code ?? error.message}`)
  }
}
if (failed.length) {
  console.error(
    `could not remove ${failed.length}:\n  ${failed.join('\n  ')}\n` +
      'Another program holds these files (often an IDE that imported the Android project, or a running dev server). ' +
      'Close it and run this again.',
  )
  process.exit(1)
}
