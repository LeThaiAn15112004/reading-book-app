/**
 * HTTP `Range` header parsing for serving a local audio file (RFC 9110 §14).
 * Pure: the Main-process stream handler decides what to do with the result.
 *
 * Only a single `bytes=` range is honoured. Anything else that is syntactically invalid (several
 * ranges, a non-numeric value, an inverted `a-b`, another unit) is `ignore`: the server may then
 * answer `200` with the whole entity, which is what the spec allows. A range that is well-formed but
 * starts at or after the end of the file is `unsatisfiable` (→ `416`).
 */
export type ByteRange =
  | { kind: 'none' }
  | { kind: 'ignore' }
  | { kind: 'unsatisfiable' }
  | { kind: 'range'; start: number; end: number }

const RANGE_RE = /^bytes=(\d*)-(\d*)$/i

/** Digits → number; beyond the safe-integer range the value is just "very large". */
function toLimit(digits: string): number {
  const n = Number(digits)
  return Number.isSafeInteger(n) ? n : Number.MAX_SAFE_INTEGER
}

export function parseByteRange(header: string | null | undefined, size: number): ByteRange {
  if (header == null || header.trim() === '') return { kind: 'none' }
  const match = RANGE_RE.exec(header.trim())
  if (!match) return { kind: 'ignore' }
  const first = match[1] ?? ''
  const last = match[2] ?? ''
  if (first === '' && last === '') return { kind: 'ignore' }

  if (first === '') {
    // Suffix range: the last N bytes.
    const n = toLimit(last)
    if (n === 0 || size <= 0) return { kind: 'unsatisfiable' }
    return { kind: 'range', start: Math.max(0, size - n), end: size - 1 }
  }

  const start = toLimit(first)
  if (last !== '' && toLimit(last) < start) return { kind: 'ignore' }
  if (start >= size) return { kind: 'unsatisfiable' }
  const end = last === '' ? size - 1 : Math.min(toLimit(last), size - 1)
  return { kind: 'range', start, end }
}
