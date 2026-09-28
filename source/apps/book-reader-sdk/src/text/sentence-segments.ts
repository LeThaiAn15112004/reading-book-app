/**
 * Read-aloud / TTS text segmentation: a section's plain text split into sentence-sized segments
 * (Intl.Segmenter when available, regex fallback otherwise), each capped at a length speech
 * engines handle reliably. Pure string logic — the host maps offsets back to its own text nodes.
 */

export type ReadAloudSegment = {
  /** Offsets into the segmented text; both ends land on real (non-synthetic) characters. */
  start: number
  end: number
  text: string
}

/** Chromium's (and some mobile) speech engines may silently stop on very long utterances. */
const MAX_SEGMENT_CHARS = 250
const HAS_SPEAKABLE = /[\p{L}\p{N}]/u
const WHITESPACE = /\s/

type SentenceSegmenter = {
  segment(input: string): Iterable<{ segment: string; index: number }>
}
type SegmenterCtor = new (
  locale: string | undefined,
  options: { granularity: 'sentence' },
) => SentenceSegmenter

function createSentenceSegmenter(lang: string): SentenceSegmenter | null {
  const Ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter
  if (!Ctor) return null
  try {
    return new Ctor(lang || undefined, { granularity: 'sentence' })
  } catch {
    return new Ctor(undefined, { granularity: 'sentence' })
  }
}

/** Sentence spans (relative offsets) of one paragraph. */
function sentenceSpans(paragraph: string, segmenter: SentenceSegmenter | null): Array<[number, number]> {
  if (segmenter) {
    return Array.from(segmenter.segment(paragraph), (s) => [s.index, s.index + s.segment.length])
  }
  const spans: Array<[number, number]> = []
  const re = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g
  for (let m = re.exec(paragraph); m; m = re.exec(paragraph)) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    spans.push([m.index, m.index + m[0].length])
  }
  return spans
}

function pushSegment(text: string, start: number, end: number, out: ReadAloudSegment[]): void {
  while (start < end && WHITESPACE.test(text[start] ?? '')) start++
  while (end > start && WHITESPACE.test(text[end - 1] ?? '')) end--
  if (start >= end) return

  if (end - start > MAX_SEGMENT_CHARS) {
    const limit = start + MAX_SEGMENT_CHARS
    let cut = limit
    for (let i = limit; i > start + MAX_SEGMENT_CHARS / 2; i--) {
      if (WHITESPACE.test(text[i] ?? '')) {
        cut = i
        break
      }
    }
    pushSegment(text, start, cut, out)
    pushSegment(text, cut, end, out)
    return
  }

  const slice = text.slice(start, end)
  if (!HAS_SPEAKABLE.test(slice)) return
  out.push({ start, end, text: slice.replace(/\s+/g, ' ') })
}

export function segmentSectionText(text: string, lang: string): ReadAloudSegment[] {
  const segmenter = createSentenceSegmenter(lang)
  const out: ReadAloudSegment[] = []
  const paragraphs = /[^\n]+/g
  for (let p = paragraphs.exec(text); p; p = paragraphs.exec(text)) {
    for (const [s, e] of sentenceSpans(p[0], segmenter)) {
      pushSegment(text, p.index + s, p.index + e, out)
    }
  }
  return out
}
