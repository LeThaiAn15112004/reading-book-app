/**
 * Just enough PDF object syntax (ISO 32000-1 §7.3) for the incremental writer to read and patch
 * dictionaries without understanding them: value extents, top-level dictionary entries, references,
 * and string / number serialization. Works on latin1 text (one char per byte). Must not import
 * `electron`.
 */

const WS = /[\0\t\n\f\r ]/
const DELIM = /[()<>[\]{}/%]/

export class PdfSyntaxError extends Error {}

function isWs(ch: string | undefined): boolean {
  return ch !== undefined && WS.test(ch)
}

/** Index of the next non-whitespace, non-comment char at or after `i`. */
export function skipWs(text: string, i: number): number {
  while (i < text.length) {
    const ch = text[i]
    if (isWs(ch)) i++
    else if (ch === '%') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++
    } else break
  }
  return i
}

function skipLiteral(text: string, i: number): number {
  let depth = 0
  for (; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') i++
    else if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i + 1
  }
  throw new PdfSyntaxError('unterminated string')
}

function regularEnd(text: string, i: number): number {
  while (i < text.length && !isWs(text[i]) && !DELIM.test(text[i]!)) i++
  return i
}

/** End index (exclusive) of the value starting at `start` (whitespace already skipped). */
export function valueEnd(text: string, start: number): number {
  const ch = text[start]
  if (ch === undefined) throw new PdfSyntaxError('value expected')
  if (ch === '(') return skipLiteral(text, start)
  if (ch === '<' && text[start + 1] === '<') {
    let i = start + 2
    for (;;) {
      i = skipWs(text, i)
      if (i >= text.length) throw new PdfSyntaxError('unterminated dictionary')
      if (text[i] === '>' && text[i + 1] === '>') return i + 2
      i = valueEnd(text, i)
    }
  }
  if (ch === '<') {
    const end = text.indexOf('>', start)
    if (end === -1) throw new PdfSyntaxError('unterminated hex string')
    return end + 1
  }
  if (ch === '[') {
    let i = start + 1
    for (;;) {
      i = skipWs(text, i)
      if (i >= text.length) throw new PdfSyntaxError('unterminated array')
      if (text[i] === ']') return i + 1
      i = valueEnd(text, i)
    }
  }
  if (ch === '/') return regularEnd(text, start + 1)
  // number — maybe the start of `num gen R`
  const end = regularEnd(text, start)
  if (end === start) throw new PdfSyntaxError(`unexpected '${ch}'`)
  if (/^\d+$/.test(text.slice(start, end))) {
    const a = skipWs(text, end)
    const genEnd = regularEnd(text, a)
    if (genEnd > a && /^\d+$/.test(text.slice(a, genEnd))) {
      const r = skipWs(text, genEnd)
      if (text[r] === 'R' && (r + 1 >= text.length || isWs(text[r + 1]) || DELIM.test(text[r + 1]!))) return r + 1
    }
  }
  return end
}

export type DictEntry = { key: string; keyStart: number; valueStart: number; valueEnd: number }
export type ParsedDict = { start: number; end: number; entries: DictEntry[] }

/** The first dictionary in `text` (e.g. an object body) with its top-level entries. */
export function parseDict(text: string, from = 0): ParsedDict {
  const start = text.indexOf('<<', from)
  if (start === -1) throw new PdfSyntaxError('dictionary expected')
  const entries: DictEntry[] = []
  let i = start + 2
  for (;;) {
    i = skipWs(text, i)
    if (i >= text.length) throw new PdfSyntaxError('unterminated dictionary')
    if (text[i] === '>' && text[i + 1] === '>') return { start, end: i + 2, entries }
    if (text[i] !== '/') throw new PdfSyntaxError('name expected as dictionary key')
    const keyStart = i
    const keyEnd = regularEnd(text, i + 1)
    const valueStart = skipWs(text, keyEnd)
    const end = valueEnd(text, valueStart)
    entries.push({ key: text.slice(i + 1, keyEnd), keyStart, valueStart, valueEnd: end })
    i = end
  }
}

export function dictValue(text: string, dict: ParsedDict, key: string): string | undefined {
  const entry = dict.entries.find((e) => e.key === key)
  return entry ? text.slice(entry.valueStart, entry.valueEnd) : undefined
}

/**
 * The dictionary text with `updates` applied: a string value sets (replacing in place or appending),
 * `null` removes the key. Everything else is kept byte for byte.
 */
export function patchDict(text: string, dict: ParsedDict, updates: Record<string, string | null>): string {
  let out = ''
  let cursor = dict.start
  const pending = new Map(Object.entries(updates))
  for (const entry of dict.entries) {
    if (!pending.has(entry.key)) continue
    const value = pending.get(entry.key)!
    pending.delete(entry.key)
    out += text.slice(cursor, entry.keyStart)
    if (value !== null) out += `/${entry.key} ${value}`
    cursor = entry.valueEnd
  }
  const close = dict.end - 2
  out += text.slice(cursor, close)
  for (const [key, value] of pending) if (value !== null) out += ` /${key} ${value}`
  return out + '>>'
}

export type PdfRef = { num: number; gen: number }

/** `12 0 R` → ref; undefined for anything else. */
export function parseRef(value: string | undefined): PdfRef | undefined {
  const m = value === undefined ? null : /^\s*(\d+)\s+(\d+)\s+R\s*$/.exec(value)
  return m ? { num: Number(m[1]), gen: Number(m[2]) } : undefined
}

/** The references of an array value (`[1 0 R 5 0 R]`); other items are ignored. */
export function parseRefArray(value: string): PdfRef[] {
  const refs: PdfRef[] = []
  const re = /(\d+)\s+(\d+)\s+R/g
  for (let m = re.exec(value); m; m = re.exec(value)) refs.push({ num: Number(m[1]), gen: Number(m[2]) })
  return refs
}

export const refText = (ref: PdfRef) => `${ref.num} ${ref.gen} R`

/** A number with at most 4 decimals, no exponent, no trailing zeros. */
export function num(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const s = (Math.round(value * 10000) / 10000).toFixed(4)
  return s.replace(/\.?0+$/, '') || '0'
}

/** A PDF text string: a literal for printable ASCII, UTF-16BE hex with BOM otherwise. */
export function textString(value: string): string {
  if (/^[\x20-\x7e\n\r\t]*$/.test(value)) {
    return `(${value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')})`
  }
  let hex = 'FEFF'
  for (const ch of value) {
    const code = ch.codePointAt(0)!
    if (code > 0xffff) {
      const v = code - 0x10000
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0')
    } else hex += code.toString(16).padStart(4, '0')
  }
  return `<${hex.toUpperCase()}>`
}
