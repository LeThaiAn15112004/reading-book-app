// Spec 010 T016 — checks a built Store package (contracts/store-build.md "Package content rules").
//
//   node source/scripts/store/check-store-package.mjs <file.msix>     (Windows; run by package-store.mjs)
//
// Reads the package with the Windows tar.exe (bsdtar, reads ZIP; the Git-for-Windows GNU tar does not), extracts
// AppxManifest.xml and checks it against store-identity.json + the release version, then checks the file listing.
// One line per assertion; exit 1 on any failure.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadStoreInputs } from './check-store-config.mjs'
import { requireWindows } from './platform-guard.mjs'

const STARTUP_TASK_ID = 'ReadmateReaderStartup'
const PROTOCOL = 'readmate-reader'
export const REQUIRED_FILES = [
  'AppxManifest.xml',
  'app/resources/app.asar',
  'app/resources/ffmpeg/win32-x64/ffmpeg.exe',
  'app/resources/store/startup-task.ps1',
]
const FORBIDDEN_BASENAME = [/^cloud-oauth-secrets\.json$/i, /^client_secret_.*\.json$/i]

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null
const tags = (xml, name) => xml.match(new RegExp(`<${name}\\b[^>]*>`, 'g')) ?? []

/** Assertions on AppxManifest.xml → `{ name, ok, detail }[]`. */
export function checkManifest(xml, { identity, version }) {
  const results = []
  const assert = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail })

  const id = tags(xml, 'Identity')[0] ?? ''
  assert('Identity Name', attr(id, 'Name') === identity.identityName, `${attr(id, 'Name')} vs ${identity.identityName}`)
  assert('Identity Publisher', attr(id, 'Publisher') === xmlEscape(identity.publisher), `${attr(id, 'Publisher')} vs ${identity.publisher}`)
  assert('Identity Version', attr(id, 'Version') === `${version}.0`, `${attr(id, 'Version')} vs ${version}.0`)
  assert('ProcessorArchitecture x64', attr(id, 'ProcessorArchitecture') === 'x64', attr(id, 'ProcessorArchitecture'))

  const caps = /<Capabilities>([\s\S]*?)<\/Capabilities>/.exec(xml)?.[1] ?? ''
  const capTags = caps.match(/<[A-Za-z0-9]+:?[A-Za-z]*Capability\b[^>]*>/g) ?? []
  const capNames = capTags.map((t) => `${/^<([^\s>]+)/.exec(t)[1]}:${attr(t, 'Name')}`)
  assert('Capabilities = runFullTrust only', capNames.length === 1 && capNames[0] === 'rescap:Capability:runFullTrust', capNames.join(', ') || 'none')

  const protocols = tags(xml, 'uap:Protocol').map((t) => attr(t, 'Name'))
  assert(`one windows.protocol "${PROTOCOL}"`, protocols.length === 1 && protocols[0] === PROTOCOL, protocols.join(', ') || 'none')

  const startup = (xml.match(/Category="windows\.startupTask"/g) ?? []).length
  const taskIds = tags(xml, 'desktop:StartupTask').map((t) => attr(t, 'TaskId'))
  assert(`one windows.startupTask "${STARTUP_TASK_ID}"`, startup === 1 && taskIds.length === 1 && taskIds[0] === STARTUP_TASK_ID, `${startup} task(s): ${taskIds.join(', ')}`)

  const family = tags(xml, 'TargetDeviceFamily')[0] ?? ''
  assert(`MinVersion ${identity.minVersion}`, attr(family, 'MinVersion') === identity.minVersion, attr(family, 'MinVersion'))
  assert('Windows.Desktop device family', attr(family, 'Name') === 'Windows.Desktop', attr(family, 'Name'))
  return results
}

/** Package entry names are percent-encoded (OPC); normalise to plain forward-slash paths. */
export function normaliseEntry(entry) {
  let p = entry.replaceAll('\\', '/').replace(/^\.?\/+/, '')
  try {
    p = decodeURIComponent(p)
  } catch {
    // keep the raw name
  }
  return p
}

/** Assertions on the package file list → `{ name, ok, detail }[]`. */
export function checkListing(entries) {
  const files = new Set(entries.map(normaliseEntry))
  const results = REQUIRED_FILES.map((f) => ({ name: `contains ${f}`, ok: files.has(f), detail: '' }))
  const secrets = [...files].filter((f) => FORBIDDEN_BASENAME.some((re) => re.test(path.posix.basename(f))))
  results.push({ name: 'no OAuth secret files', ok: secrets.length === 0, detail: secrets.join(', ') })
  return results
}

function windowsTar() {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
}

function main(argv) {
  requireWindows('check-store-package')
  const msix = argv[0]
  if (!msix) {
    console.error('usage: check-store-package.mjs <file.msix>')
    return 1
  }
  const tar = windowsTar()
  const listing = execFileSync(tar, ['-tf', msix], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split(/\r?\n/).filter(Boolean)
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'readmate-msix-'))
  let xml
  try {
    execFileSync(tar, ['-xf', msix, '-C', tmp, 'AppxManifest.xml'])
    xml = readFileSync(path.join(tmp, 'AppxManifest.xml'), 'utf8')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  const { identity, version } = loadStoreInputs()
  const results = [...checkManifest(xml, { identity, version }), ...checkListing(listing)]
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  (${r.detail})`}`)
  const failed = results.filter((r) => !r.ok).length
  console.log(failed ? `check-store-package: ${failed} failed` : 'check-store-package: OK')
  return failed ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
