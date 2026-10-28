/**
 * Puts one FFmpeg build into the app: `resources/ffmpeg/<key>/` (shipped by electron-builder `extraResources`, outside
 * the asar) and its SHA-256 into `electron/transcription/ffmpeg-artifacts.json` (the table the app checks before every
 * first run). Refuses a binary that is not what the decoder needs.
 *
 *   node scripts/ffmpeg/stage-ffmpeg.mjs <key> <built ffmpeg binary> <configured ffmpeg source dir> [licence file ...]
 *
 * <key>              win32-x64 | darwin-arm64 | darwin-x64 (must match the machine the binary was built for)
 * <source dir>       the tree the binary was built from: its COPYING.LGPLv2.1 / LICENSE.md and the configure line
 *                    (config.h) are shipped next to the binary
 * [licence file]     notices of anything linked statically into the binary (e.g. MinGW-w64 winpthreads), copied to
 *                    licenses/ as is
 *
 * Checks before anything is written: the configure line has no --enable-gpl / --enable-nonfree / --enable-version3;
 * on Windows the binary imports only DLLs that ship with Windows; when the binary can run here, it reports LGPL and
 * has the f32le muxer. Review the JSON diff before committing: the hash is the app's trust anchor.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSystemDll, peImports } from './pe-imports.mjs'

const KEYS = ['win32-x64', 'darwin-arm64', 'darwin-x64']
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const manifestPath = path.join(desktop, 'electron/transcription/ffmpeg-artifacts.json')

const [key, binary, sourceDir, ...licenceFiles] = process.argv.slice(2)
const fail = (message) => {
  console.error(`stage-ffmpeg: ${message}`)
  process.exit(1)
}
if (!KEYS.includes(key) || !binary || !sourceDir) fail('usage: stage-ffmpeg.mjs <win32-x64|darwin-arm64|darwin-x64> <binary> <source dir> [licence file ...]')

const configH = fs.readFileSync(path.join(sourceDir, 'config.h'), 'utf8')
const configure = /#define FFMPEG_CONFIGURATION "(.*)"/.exec(configH)?.[1]
if (!configure) fail('config.h has no FFMPEG_CONFIGURATION — is this the configured source tree?')
const forbidden = ['--enable-gpl', '--enable-nonfree', '--enable-version3'].filter((flag) => configure.split(' ').includes(flag))
if (forbidden.length) fail(`configure line has ${forbidden.join(', ')}: not an LGPL v2.1 build`)
if (!configure.split(' ').includes('--enable-muxer=pcm_f32le')) fail('configure line lacks --enable-muxer=pcm_f32le (`-f f32le` would not work)')
if (!/--enable-protocol=\S*\bpipe\b/.test(configure)) fail('configure line lacks the pipe protocol (`pipe:1` would fail "Protocol not found")')
const version = fs.readFileSync(path.join(sourceDir, 'VERSION'), 'utf8').trim()

if (key.startsWith('win32')) {
  const foreign = peImports(binary).filter((dll) => !isSystemDll(dll))
  if (foreign.length) fail(`the binary needs DLLs that Windows does not ship: ${foreign.join(', ')} (link it with -static)`)
}
const canRun = `${process.platform}-${process.arch}` === key
if (canRun) {
  const licence = spawnSync(binary, ['-hide_banner', '-L'], { encoding: 'utf8' })
  if (licence.status !== 0 || !/GNU Lesser General Public\s+License/.test(licence.stdout)) fail(`\`${binary} -L\` does not report LGPL (exit ${licence.status})`)
  const muxer = spawnSync(binary, ['-hide_banner', '-h', 'muxer=f32le'], { encoding: 'utf8' })
  if (muxer.status !== 0 || !/Muxer f32le\b/.test(muxer.stdout)) fail('the binary has no f32le muxer')
  const protocols = spawnSync(binary, ['-hide_banner', '-protocols'], { encoding: 'utf8' })
  if (!/Output:[\s\S]*\bpipe\b/.test(protocols.stdout)) fail('the binary cannot write to pipe:1 (no pipe output protocol)')
} else {
  console.warn(`stage-ffmpeg: ${key} binary cannot run on this machine; its LGPL / f32le self-checks were skipped`)
}

const executable = key.startsWith('win32') ? 'ffmpeg.exe' : 'ffmpeg'
const dest = path.join(desktop, 'resources/ffmpeg', key)
fs.rmSync(dest, { recursive: true, force: true })
fs.mkdirSync(path.join(dest, 'licenses'), { recursive: true })
fs.copyFileSync(binary, path.join(dest, executable))
if (!key.startsWith('win32')) fs.chmodSync(path.join(dest, executable), 0o755)
for (const name of ['COPYING.LGPLv2.1', 'LICENSE.md']) fs.copyFileSync(path.join(sourceDir, name), path.join(dest, 'licenses', name))
for (const file of licenceFiles) fs.copyFileSync(file, path.join(dest, 'licenses', path.basename(file)))

const sha256 = createHash('sha256').update(fs.readFileSync(path.join(dest, executable))).digest('hex')
fs.writeFileSync(
  path.join(dest, 'licenses', 'README.txt'),
  [
    `FFmpeg ${version} — decoder used by Readmate Reader for on-device audiobook transcription`,
    '',
    'This folder contains an unmodified build of FFmpeg (https://ffmpeg.org), licensed under the GNU Lesser General',
    'Public License version 2.1 or later (licenses/COPYING.LGPLv2.1). FFmpeg is a trademark of Fabrice Bellard.',
    'Readmate runs it as a separate program; it is not linked into Readmate.',
    '',
    `Source code: the exact FFmpeg ${version} release tarball this binary was built from is available from`,
    `https://ffmpeg.org/releases/ffmpeg-${version}.tar.xz and from the Readmate Reader release page.`,
    'No changes were made to the FFmpeg sources.',
    '',
    `Configuration: ${configure}`,
    '',
    `${executable} SHA-256: ${sha256}`,
    '',
    'Statically linked runtime components and their notices:',
    ...(licenceFiles.length ? licenceFiles.map((file) => `  licenses/${path.basename(file)}`) : ['  (none)']),
    '',
  ].join('\n'),
)

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest[key] = { executable, files: [{ name: executable, sha256 }] }
const ordered = Object.fromEntries(KEYS.filter((k) => manifest[k]).map((k) => [k, manifest[k]]))
fs.writeFileSync(manifestPath, `${JSON.stringify(ordered, null, 2)}\n`)

console.log(`staged ${path.relative(desktop, path.join(dest, executable))}`)
console.log(`  FFmpeg ${version}, SHA-256 ${sha256}`)
console.log(`  manifest updated: ${path.relative(desktop, manifestPath)} — review the diff before committing`)
