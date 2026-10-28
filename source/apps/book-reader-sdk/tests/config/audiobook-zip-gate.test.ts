import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Release gate for the audiobook ZIP import (docs/implementation_plan/audiobook_multi_track_playback_b.md §6).
 *
 * The flag stays `false` in everything that is COMMITTED until BOTH Stage B1 (see and play any track) and Stage B2
 * (navigation, auto-advance, restore, errors) have passed the full release checklist. Flipping it is a deliberate edit of
 * this file AND `packages/config/features.ts` in the single release commit — that is the review point.
 *
 * The check is made on the committed content (`git show HEAD:…`), so a developer can switch the flag on in the working
 * copy to try the menu without turning this test red; the moment a commit carries `true`, CI (which tests that commit)
 * fails. When git is not available the working-copy file is checked instead (stricter, never looser).
 */
const featuresPath = fileURLToPath(new URL('../../../../packages/config/features.ts', import.meta.url))

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

describe('audiobook ZIP import release gate', () => {
  it('is declared in the feature flags', () => {
    expect(readFileSync(featuresPath, 'utf8')).toMatch(/audiobookZipImportEnabled\s*:/)
  })

  it('is OFF in the committed defaults (Stage B1 + B2 have not passed the release gate)', () => {
    const source = committedFeaturesSource()
    expect(source).not.toMatch(/audiobookZipImportEnabled:\s*true/)
    // Once the flag is committed at all, it is committed as `false` (before that commit it simply does not exist = off).
    if (/audiobookZipImportEnabled/.test(source)) expect(source).toMatch(/^\s*audiobookZipImportEnabled:\s*false,/m)
  })
})
