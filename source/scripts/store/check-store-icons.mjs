// Spec 010 T044 — every generated logo exists at its exact size and is not blank (contracts/store-icons.md "Checks",
// SC-004). Run after generate-icons.mjs (npm run store:icons); lists every missing / wrong file, exit 1 on any.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { ICO_SIZES, OUT_DIR, expectedAssets } from './generate-icons.mjs'
import { readIcoDirectory } from './ico-writer.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')

/** Returns the list of problems (empty = OK) for the generated output in `outDir`. */
export async function checkIcons(outDir = path.join(repoRoot, OUT_DIR)) {
  const problems = []
  for (const a of expectedAssets()) {
    const file = path.join(outDir, 'appx', a.file)
    if (!existsSync(file)) {
      problems.push(`appx/${a.file}: missing`)
      continue
    }
    const meta = await sharp(file).metadata()
    if (meta.width !== a.width || meta.height !== a.height) {
      problems.push(`appx/${a.file}: ${meta.width}×${meta.height}, expected ${a.width}×${a.height}`)
    }
    const { channels } = await sharp(file).ensureAlpha().stats()
    if (!(channels[3]?.max > 0)) problems.push(`appx/${a.file}: blank (no visible pixel)`)
  }
  const icoFile = path.join(outDir, 'icon.ico')
  if (!existsSync(icoFile)) {
    problems.push('icon.ico: missing')
  } else {
    try {
      const sizes = readIcoDirectory(readFileSync(icoFile)).map((e) => e.size)
      if (sizes.join(',') !== ICO_SIZES.join(',')) problems.push(`icon.ico: sizes ${sizes.join(', ')}, expected ${ICO_SIZES.join(', ')}`)
    } catch (err) {
      problems.push(`icon.ico: ${err.message}`)
    }
  }
  return problems
}

async function main() {
  const problems = await checkIcons()
  if (problems.length > 0) {
    console.error(`check-store-icons: ${problems.length} problem(s) — run npm run store:icons:`)
    for (const p of problems) console.error(`  ${p}`)
    return 1
  }
  console.log(`check-store-icons: OK (${expectedAssets().length} logos + icon.ico)`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code))
}
