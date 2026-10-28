/**
 * electron-builder `afterPack` hook: the packaged app must contain exactly the FFmpeg the app will accept.
 *
 * For the target being packaged (`<platform>-<arch>`), when `electron/transcription/ffmpeg-artifacts.json` has an
 * entry, every listed file must sit in `<resources>/ffmpeg/<key>/` (outside the asar) with that SHA-256, the LGPL text
 * must be beside it, a Windows binary may import only DLLs that ship with Windows, and — when the target is this
 * machine — the packaged binary must start and offer the f32le muxer. Any miss fails the build: otherwise the release
 * would show "decoder missing" to every user. `READMATE_ALLOW_MISSING_FFMPEG=1` turns a missing / wrong binary into a
 * warning (local packaging without the binary staged).
 *
 * A target without an entry (macOS until a Mac build exists, Linux) is packaged without FFmpeg, with a warning; the
 * app then reports transcription as unavailable there.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import builder from 'electron-builder'
import { isSystemDll, peImports } from './pe-imports.mjs'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export default async function verifyPackagedFfmpeg(context) {
  const platform = context.electronPlatformName
  const key = `${platform}-${builder.Arch[context.arch]}`
  const resources =
    platform === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources')
  const folder = path.join(resources, 'ffmpeg', key)
  const manifest = JSON.parse(fs.readFileSync(path.join(desktop, 'electron/transcription/ffmpeg-artifacts.json'), 'utf8'))
  const artifact = manifest[key]

  if (!artifact) {
    console.warn(`  • FFmpeg: no verified artifact for ${key} — packaged without it; transcription will be unavailable on this target`)
    return
  }

  const problems = []
  for (const file of artifact.files) {
    const target = path.join(folder, ...file.name.split('/'))
    if (!fs.existsSync(target)) {
      problems.push(`${file.name} is missing`)
      continue
    }
    const actual = createHash('sha256').update(fs.readFileSync(target)).digest('hex')
    if (actual !== file.sha256) problems.push(`${file.name} SHA-256 ${actual} ≠ manifest ${file.sha256}`)
  }
  if (!fs.existsSync(path.join(folder, 'licenses', 'COPYING.LGPLv2.1'))) problems.push('licenses/COPYING.LGPLv2.1 is missing')
  const executable = path.join(folder, ...artifact.executable.split('/'))
  if (problems.length === 0 && platform === 'win32') {
    const foreign = peImports(executable).filter((dll) => !isSystemDll(dll))
    if (foreign.length) problems.push(`ffmpeg.exe needs DLLs that Windows does not ship: ${foreign.join(', ')}`)
  }
  if (problems.length === 0 && `${process.platform}-${process.arch}` === key) {
    const run = spawnSync(executable, ['-nostdin', '-hide_banner', '-h', 'muxer=f32le'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
    if (run.status !== 0 || !/Muxer f32le\b/.test(run.stdout)) problems.push(`the packaged binary did not pass its self-test (exit ${run.status}${run.error ? `, ${run.error.message}` : ''})`)
  }

  if (problems.length) {
    const message = `FFmpeg for ${key} in ${folder}: ${problems.join('; ')}. Stage it with scripts/ffmpeg/stage-ffmpeg.mjs (see docs/implementation_plan/ffmpeg_packaging.md).`
    if (process.env.READMATE_ALLOW_MISSING_FFMPEG === '1') {
      console.warn(`  • ${message} (allowed by READMATE_ALLOW_MISSING_FFMPEG=1: transcription will be unavailable in this build)`)
      return
    }
    throw new Error(message)
  }
  console.log(`  • FFmpeg ${key}: ${artifact.files.length} file(s) verified in ${path.relative(context.appOutDir, folder)}`)
}
