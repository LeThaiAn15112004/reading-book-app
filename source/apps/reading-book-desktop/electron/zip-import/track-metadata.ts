import { parseFile } from 'music-metadata'
import { probeAudioFile } from '../adapters/audio.adapter'

/** What the importer needs from one extracted track. */
export interface TrackMetadata {
  title?: string
  artists: string[]
  album?: string
  genres: string[]
  picture?: { data: Uint8Array; format: string }
  /** `null` when it could not be determined — never a reason to reject the track. */
  durationSeconds: number | null
}

export type ReadTrack = (filePath: string, format: string) => Promise<TrackMetadata>

/**
 * Validate one extracted track with the importer's own rule (`probeAudioFile`: real container AND codec, throws a
 * readable Error otherwise), then read its tags and — separately, so that a failure here can never reject a playable
 * file — its duration.
 */
export const readTrackMetadata: ReadTrack = async (filePath, format) => {
  const parsed = await probeAudioFile(filePath, format)
  const { common } = parsed
  let durationSeconds: number | null = null
  try {
    const timed = await parseFile(filePath, { duration: true, includeChapters: false })
    const d = timed.format.duration
    if (typeof d === 'number' && Number.isFinite(d) && d > 0) durationSeconds = d
  } catch {
    durationSeconds = null
  }
  const artists = (common.artists?.length ? common.artists : common.artist ? [common.artist] : [])
    .map((a) => a.trim())
    .filter(Boolean)
  const picture = common.picture?.[0]
  return {
    title: common.title?.trim() || undefined,
    artists,
    album: common.album?.trim() || undefined,
    genres: (common.genre ?? []).slice(0, 8),
    picture: picture ? { data: picture.data, format: picture.format } : undefined,
    durationSeconds,
  }
}
