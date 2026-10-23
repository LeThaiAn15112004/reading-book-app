import { parseFile } from 'music-metadata'

/**
 * Chapters a file declares about itself, as unvalidated seconds. Validation against the real duration
 * (`normalizeChapters` in the SDK) happens in the renderer, where the duration is known.
 *
 * Only what the file actually says is returned — an MP3 with no chapter tags gives `[]`, never a
 * guess. Sources, as read by `music-metadata` (checked in docs/implementation_plan/audiobook_implementation_plan.md):
 *  - ID3v2 `CHAP` / `CTOC` frames: start and end already in seconds;
 *  - MP4 chapter lists (`chpl`, relevant to M4B once that format is supported): start in `timeScale`
 *    units and no end — converted to seconds, the end is left for the validator (= next start).
 */
export async function readAudioChapters(
  filePath: string,
): Promise<Array<{ id: string; title: string; startSeconds: number; endSeconds?: number }>> {
  const parsed = await parseFile(filePath, { includeChapters: true, duration: false })
  const chapters = parsed.format.chapters ?? []
  return chapters.map((c, index) => {
    const scale = typeof c.timeScale === 'number' && c.timeScale > 0 ? c.timeScale : 1
    const out: { id: string; title: string; startSeconds: number; endSeconds?: number } = {
      id: typeof c.id === 'string' && c.id ? c.id : `ch-${index + 1}`,
      title: typeof c.title === 'string' ? c.title : '',
      startSeconds: c.start / scale,
    }
    const end = (c as { end?: unknown }).end
    if (typeof end === 'number') out.endSeconds = end / scale
    return out
  })
}
