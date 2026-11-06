/** Word error rate helpers for the transcription spikes (T014a now, T036 later). */

/** Lower-case, drop punctuation (Unicode-aware, keeps letters incl. diacritics and digits), collapse whitespace. */
export function normaliseWords(text) {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** (substitutions + deletions + insertions) / reference words, via word-level Levenshtein distance. */
export function wordErrorRate(reference, hypothesis) {
  const ref = normaliseWords(reference)
  const hyp = normaliseWords(hypothesis)
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1
  const prev = Array.from({ length: hyp.length + 1 }, (_, j) => j)
  for (let i = 1; i <= ref.length; i += 1) {
    let diagonal = prev[0]
    prev[0] = i
    for (let j = 1; j <= hyp.length; j += 1) {
      const above = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (ref[i - 1] === hyp[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return prev[hyp.length] / ref.length
}
