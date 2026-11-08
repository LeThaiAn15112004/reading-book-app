// Spec 010 T015 — `npm run package:store`: the Microsoft Store package (.msix, x64), next to the NSIS installer
// (contracts/store-build.md "Commands").
//
//   npm run package:store                 # unsigned package for the Partner Center upload
//   npm run package:store -- --test-sign  # signed with the local test certificate (spec 010 US4, T019–T021)
//   (Windows PowerShell drops the "--" for npm.ps1; the flag then arrives as npm_config_test_sign and is still
//    honoured — `npm.cmd run package:store -- --test-sign` passes it directly. See test-sign.mjs testSignRequest.)
//
// Steps, each stopping the run with its name when it fails:
//   1. Windows only (platform-guard)          5. electron-builder --win appx --config electron-builder.store.cjs
//   2. check-store-config (no placeholders)   6. check-desktop-package on release/<v>/win-unpacked/resources/app.asar
//   3. store icons                            7. check-store-package on the .msix
//   4. tsc + check:package-deps + vite build  8. print the package path + SHA-256
//
// Every child is spawned with an argv array (no shell). Without --test-sign the signing variables are removed from the
// child environment, so a stray CSC_LINK can never sign the upload package.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkStoreConfig, loadStoreInputs } from './check-store-config.mjs'
import { requireWindows } from './platform-guard.mjs'
import { readPfxSubject, resolveTestSigning } from './test-sign.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')
const HOST = path.join(repoRoot, 'source/app/platforms/electron')
const node = process.execPath
const bin = (rel) => path.join(repoRoot, 'node_modules', rel)

/**
 * Variables that can sign or hold signing secrets; removed from EVERY child's environment. The electron-builder child
 * of a --test-sign build gets back only WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD (test-sign.mjs).
 */
export const SIGNING_ENV_VARS = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
  'CSC_NAME',
  'READMATE_STORE_TEST_PFX',
  'READMATE_STORE_TEST_PFX_PASSWORD',
]

/** The child environment of an unsigned build: the parent's, without any signing variable. */
export function unsignedChildEnv(env) {
  const out = { ...env }
  for (const k of Object.keys(out)) if (SIGNING_ENV_VARS.includes(k.toUpperCase())) delete out[k]
  return out
}

/** release/<version>/ paths of one build (artifactName in electron-builder.store.cjs). */
export function releasePaths(version, root = repoRoot) {
  const dir = path.join(root, 'source/app/platforms/electron/release', version)
  return {
    dir,
    msix: path.join(dir, `Readmate Reader-Windows-${version}-Store.msix`),
    asar: path.join(dir, 'win-unpacked/resources/app.asar'),
  }
}

export const UNSIGNED_NOTE =
  'Unsigned package for Partner Center upload. It cannot be installed locally; use --test-sign for that.'

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

function step(name, args, { cwd = repoRoot, env } = {}) {
  console.log(`\n▶ package:store — ${name}`)
  const r = spawnSync(args[0], args.slice(1), { cwd, env, stdio: 'inherit', shell: false })
  if (r.error || r.status !== 0) {
    console.error(`✖ package:store stopped at "${name}"${r.error ? `: ${r.error.message}` : ` (exit ${r.status})`}`)
    process.exit(1)
  }
}

async function main(argv) {
  requireWindows('package:store')

  console.log('▶ package:store — check-store-config')
  const inputs = loadStoreInputs()
  const { errors } = checkStoreConfig({ ...inputs, allowPlaceholders: false })
  if (errors.length > 0) {
    console.error(`check-store-config: ${errors.length} problem(s), nothing built:`)
    for (const e of errors) console.error(`  [${e.code}] ${e.message}`)
    return 1
  }
  const version = inputs.version
  const env = unsignedChildEnv(process.env)

  // Test signing (US4): decided BEFORE anything is built; a wrong certificate builds nothing.
  const signing = resolveTestSigning({
    argv,
    env: process.env,
    repoRoot,
    publisher: inputs.identity.publisher,
    readSubject: readPfxSubject,
  })
  if (signing.signing) {
    console.log('▶ package:store — test certificate')
    for (const w of signing.warnings) console.warn(`⚠ ${w}`)
    if (signing.errors.length > 0) {
      console.error(`test signing: ${signing.errors.length} problem(s), nothing built:`)
      for (const e of signing.errors) console.error(`  [${e.code}] ${e.message}`)
      return 1
    }
    console.log(`  subject ${signing.subject} = appx.publisher`)
  } else {
    // Never silent: an unsigned build says so before it starts.
    console.log('▶ package:store — signing: none (unsigned upload package; add --test-sign to sign for sideloading)')
  }

  // Icons (US3): every Store logo + icon.ico from the master icon, then their exact sizes are checked.
  step('store icons', [node, path.join(here, 'generate-icons.mjs')], { env })
  step('store icons check', [node, path.join(here, 'check-store-icons.mjs')], { env })

  step('tsc (Desktop)', [node, bin('typescript/bin/tsc'), '-p', 'tsconfig.electron.json'], { env })
  step('check:package-deps', [node, path.join(repoRoot, 'source/scripts/desktop-package-deps.mjs')], { env })
  step('vite build', [node, bin('vite/bin/vite.js'), 'build', '--config', path.join(repoRoot, 'vite.config.ts')], { cwd: HOST, env })
  step('electron-builder (appx)', [node, bin('electron-builder/cli.js'), '--win', 'appx', '--config', 'electron-builder.store.cjs'], {
    env: signing.env ? { ...env, ...signing.env } : env,
  })

  const out = releasePaths(version)
  step('check-desktop-package', [node, path.join(repoRoot, 'source/scripts/check-desktop-package.mjs'), out.asar], { env })
  if (!existsSync(out.msix)) {
    console.error(`✖ package:store: electron-builder finished but ${out.msix} does not exist`)
    return 1
  }
  step('check-store-package', [node, path.join(here, 'check-store-package.mjs'), out.msix], { env })

  console.log(`\n✔ ${out.msix}`)
  console.log(`  SHA-256 ${await sha256(out.msix)}`)
  console.log(signing.env ? `  Signed with the test certificate ${signing.subject} (sideload only).` : `  ${UNSIGNED_NOTE}`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err)
      process.exit(1)
    },
  )
}
