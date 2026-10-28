import manifest from './ffmpeg-artifacts.json'

/**
 * The FFmpeg artifacts the app may run for audiobook transcription (spec 004, research R2 / prerequisite B3):
 * our own minimal, decode-only, LGPL build, one folder per platform under `resources/ffmpeg/<key>/`.
 *
 * The table lives in `ffmpeg-artifacts.json` (bundled into the app, so it is checked from inside the asar, never from
 * next to the binary) so that the packaging hook `scripts/ffmpeg/verify-packaged-ffmpeg.mjs` checks the very same
 * hashes. An entry is written only by `scripts/ffmpeg/stage-ffmpeg.mjs` from an actual build recorded in
 * `specs/004-audiobook-transcription/ffmpeg-build-record.md`. A platform without an entry reports the decoder
 * unavailable and never spawns anything.
 *
 * Built so far: win32-x64 only. macOS arm64 / x64 (separate binaries, no universal one) need their own build on a
 * Mac; Linux is NOT supported until a Linux binary is built and verified.
 */

export interface FfmpegArtifactFile {
  /** Path relative to the artifact folder, forward slashes. */
  name: string
  /** Lower-case hex SHA-256 of that file, from a real build. */
  sha256: string
}

export interface FfmpegArtifact {
  /** File name of the executable inside the artifact folder (must also be listed in `files`). */
  executable: string
  /** Every file that gets loaded or run: the executable and, for a shared build, its libraries. */
  files: readonly FfmpegArtifactFile[]
}

export const FFMPEG_ARTIFACT_KEYS = ['win32-x64', 'darwin-arm64', 'darwin-x64'] as const
export type FfmpegArtifactKey = (typeof FFMPEG_ARTIFACT_KEYS)[number]

/** Entries are still checked with `isUsableArtifact` before use; an unknown key in the JSON is ignored. */
export const FFMPEG_ARTIFACTS: Readonly<Partial<Record<FfmpegArtifactKey, FfmpegArtifact>>> = manifest

/** `platform-arch` for a supported target, null for anything else (Linux, win32-arm64 …). */
export function ffmpegArtifactKey(platform: string, arch: string): FfmpegArtifactKey | null {
  const key = `${platform}-${arch}`
  return (FFMPEG_ARTIFACT_KEYS as readonly string[]).includes(key) ? (key as FfmpegArtifactKey) : null
}

/**
 * FR-017: transcription is offered only where a decoder for THIS platform and CPU architecture ships (a usable manifest
 * entry). Anywhere else (macOS until its binaries exist, Linux, win32-arm64) the feature is hidden as if switched off.
 * This says nothing about whether the binary runs — `createAudioDecoder().availability()` still checks that.
 */
export function isTranscriptionPlatformSupported(
  platform: string = process.platform,
  arch: string = process.arch,
  artifacts: Readonly<Partial<Record<FfmpegArtifactKey, FfmpegArtifact>>> = FFMPEG_ARTIFACTS,
): boolean {
  const key = ffmpegArtifactKey(platform, arch)
  const artifact = key ? artifacts[key] : undefined
  return artifact !== undefined && isUsableArtifact(artifact)
}

const SHA256_HEX = /^[0-9a-f]{64}$/

/** A manifest entry is only trusted when it names the executable and every file has a well-formed SHA-256. */
export function isUsableArtifact(artifact: FfmpegArtifact): boolean {
  return (
    artifact.executable.length > 0 &&
    artifact.files.length > 0 &&
    artifact.files.some((file) => file.name === artifact.executable) &&
    artifact.files.every(
      (file) =>
        SHA256_HEX.test(file.sha256) &&
        file.name.length > 0 &&
        !file.name.startsWith('/') &&
        !file.name.includes('\\') &&
        !file.name.split('/').some((part) => part === '..' || part === ''),
    )
  )
}
