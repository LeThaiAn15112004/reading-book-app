import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Release gate for audiobook transcription (spec 004-audiobook-transcription, task T033).
 *
 * `features.audiobookTranscriptionEnabled` stays `false` in everything that is COMMITTED until the own-build FFmpeg decoder
 * (T001a build + T001b licence evidence + T001 integration) is integrated AND verified, because without it no audio can be
 * decoded. Flipping it is a deliberate edit of this file AND `packages/config/features.ts` in the single release commit — that
 * is the review point. Same pattern as `audiobook-zip-gate.test.ts` (which is NOT touched or weakened by this file).
 *
 * Two layers:
 *  1. the COMMITTED content (`git show HEAD:…`) must carry `false` (a developer may switch it on in the working copy; the moment
 *     a commit carries `true`, CI — which tests that commit — fails). When git is not available the working-copy file is
 *     checked instead (stricter, never looser);
 *  2. even in the WORKING copy, turning it on needs a decoder to exist: at least one platform must have an artifact in
 *     `ffmpeg-artifacts.json` with SHA-256 values; platforms without one are hidden by FR-017
 *     (`isTranscriptionPlatformSupported`). (While the flag is off, as it is, this proves nothing is needed.)
 *
 * The last block checks that the flag is wired at both boundaries (Main refuses start / model download; the audiobook screen
 * hides the entry and the tab). The behaviour itself is tested in `spike:transcription:main`; these are static guards against
 * the wiring being deleted.
 */
const featuresPath = fileURLToPath(new URL('../../../../packages/config/features.ts', import.meta.url))
const desktop = (relative: string): string => fileURLToPath(new URL(`../../../reading-book-desktop/${relative}`, import.meta.url))

function committedFeaturesSource(): string {
  try {
    return execFileSync('git', ['show', 'HEAD:source/packages/config/features.ts'], {
      cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return readFileSync(featuresPath, 'utf8')
  }
}

describe('audiobook transcription release gate', () => {
  it('is declared in the feature flags', () => {
    expect(readFileSync(featuresPath, 'utf8')).toMatch(/audiobookTranscriptionEnabled\s*:/)
  })

  it('is OFF in the committed defaults (the own-build FFmpeg decoder is not integrated and verified yet)', () => {
    const source = committedFeaturesSource()
    expect(source).not.toMatch(/audiobookTranscriptionEnabled:\s*true/)
    // Once the flag is committed at all, it is committed as `false` (before that commit it simply does not exist = off).
    if (/audiobookTranscriptionEnabled/.test(source)) expect(source).toMatch(/^\s*audiobookTranscriptionEnabled:\s*false,/m)
  })

  it('may be ON in the working copy only when a verified FFmpeg artifact exists for at least one platform (FR-017 hides the rest)', () => {
    const source = readFileSync(featuresPath, 'utf8')
    if (!/^\s*audiobookTranscriptionEnabled:\s*true/m.test(source)) return // off: nothing to prove
    const manifest = JSON.parse(readFileSync(desktop('electron/transcription/ffmpeg-artifacts.json'), 'utf8')) as Record<
      string,
      { executable: string; files: { name: string; sha256: string }[] }
    >
    const keys = Object.keys(manifest)
    expect(keys.length, 'FFMPEG_ARTIFACTS has no entry at all, so transcription cannot be switched on').toBeGreaterThan(0)
    for (const [key, entry] of Object.entries(manifest)) {
      expect(entry.files.some((file) => file.name === entry.executable), `${key}: executable is not listed`).toBe(true)
      for (const file of entry.files) expect(file.sha256, `${key}/${file.name} needs a real SHA-256`).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('is enforced at both boundaries: Main refuses start / model download, the audiobook screen hides the entry and the tab', () => {
    const service = readFileSync(desktop('electron/transcription/transcription-service.ts'), 'utf8')
    expect(service.match(/if \(!isEnabled\(\)\) return failure\('FEATURE_DISABLED'/g)?.length, 'start and downloadModel both check the flag first').toBe(2)

    const runtime = readFileSync(desktop('electron/transcription/transcription-runtime.ts'), 'utf8')
    expect(runtime).toMatch(/isEnabled:\s*\(\)\s*=>\s*features\.audiobookTranscriptionEnabled\s*&&\s*isTranscriptionPlatformSupported\(\)/)

    const screen = readFileSync(desktop('src/screens/AudioBook/AudioBookScreen.tsx'), 'utf8')
    expect(screen).toMatch(/features\.audiobookTranscriptionEnabled\s*&&\s*platformSupported/)
    expect(screen).toMatch(/info\.transcriptionSupported/)
  })
})
