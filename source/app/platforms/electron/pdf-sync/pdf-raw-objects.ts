/**
 * Read each annotation's `/NM` (name) straight from the PDF bytes — PDF.js 5.4.624 parses `/NM`
 * nowhere in its public annotation data, but it does give each annotation's object reference
 * (`"12R"`, `"12R3"` for generation 3). See docs/implementation_plan/pdf_embedded_annotation_live_sync.md.
 *
 * Deliberately small, read-only and best-effort:
 *  - plain objects `N G obj … endobj` — the **last** one wins (an incremental save appends the
 *    newer version after the older one);
 *  - objects inside FlateDecode object streams (`/Type /ObjStm`, no predictor) — a stream placed
 *    after a plain copy of the same object is the newer version;
 *  - `/NM` as a literal `( … )` or hex `< … >` string, PDFDocEncoding / UTF-16BE / UTF-8 BOM.
 * Anything else (other filters, broken streams, encrypted files) just yields no name for that
 * annotation, and the caller falls back to the geometry identity. Never throws for bad input.
 */
import { inflateSync } from 'node:zlib'

/** Hard limits so a hostile file can't make the scan worker allocate without bound. */
const MAX_OBJECT_STREAMS = 2000
const MAX_INFLATED_BYTES = 64 * 1024 * 1024

type Located = { body: string; position: number }

function parseRef(objectId: string): { num: number; gen: number } | null {
  const m = /^(\d+)R(\d*)$/.exec(objectId)
  if (!m) return null
  return { num: Number(m[1]), gen: m[2] ? Number(m[2]) : 0 }
}

/** Every `N G obj` in the file → position of its body (last occurrence wins). */
function indexPlainObjects(text: string): Map<string, number> {
  const index = new Map<string, number>()
  const re = /(?<![0-9])(\d+)\s+(\d+)\s+obj\b/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    index.set(`${m[1]} ${m[2]}`, m.index + m[0].length)
  }
  return index
}

function bodyAt(text: string, start: number): string {
  const end = text.indexOf('endobj', start)
  return text.slice(start, end === -1 ? Math.min(text.length, start + 65536) : end)
}

/** Objects held in FlateDecode object streams → their text and the stream's file position. */
function indexObjectStreams(text: string, plain: Map<string, number>): Map<number, Located> {
  const found = new Map<number, Located>()
  let streams = 0
  for (const start of plain.values()) {
    const head = text.slice(start, start + 1024)
    if (!/\/Type\s*\/ObjStm\b/.test(head)) continue
    if (++streams > MAX_OBJECT_STREAMS) break
    try {
      const dictEnd = head.indexOf('stream')
      if (dictEnd === -1) continue
      const dict = head.slice(0, dictEnd)
      if (!/\/Filter\s*(\[\s*)?\/FlateDecode\s*\]?/.test(dict) || /\/DecodeParms/.test(dict)) continue
      const n = Number(/\/N\s+(\d+)/.exec(dict)?.[1])
      const first = Number(/\/First\s+(\d+)/.exec(dict)?.[1])
      if (!Number.isInteger(n) || !Number.isInteger(first) || n <= 0) continue
      let dataStart = start + dictEnd + 'stream'.length
      if (text[dataStart] === '\r') dataStart++
      if (text[dataStart] === '\n') dataStart++
      const dataEnd = text.indexOf('endstream', dataStart)
      if (dataEnd === -1) continue
      const raw = Buffer.from(text.slice(dataStart, dataEnd), 'latin1')
      const decoded = inflateSync(raw, { maxOutputLength: MAX_INFLATED_BYTES }).toString('latin1')
      const header = decoded.slice(0, first).trim().split(/\s+/).map(Number)
      for (let i = 0; i < n; i++) {
        const num = header[2 * i]
        const offset = header[2 * i + 1]
        if (num === undefined || offset === undefined || !Number.isInteger(num) || !Number.isInteger(offset)) break
        const next = i + 1 < n ? header[2 * i + 3] : undefined
        const body = decoded.slice(first + offset, next === undefined ? undefined : first + next)
        const previous = found.get(num)
        if (!previous || previous.position < start) found.set(num, { body, position: start })
      }
    } catch {
      // A stream we can't inflate just contributes nothing.
    }
  }
  return found
}

/** Skip a literal string starting at `i` (on its `(`); returns the index after its `)`. */
function skipLiteral(text: string, i: number): number {
  let depth = 0
  for (; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') i++
    else if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i + 1
  }
  return text.length
}

function decodeLiteral(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = raw[++i]
    if (next === undefined) break
    if (next === 'n') out += '\n'
    else if (next === 'r') out += '\r'
    else if (next === 't') out += '\t'
    else if (next === 'b') out += '\b'
    else if (next === 'f') out += '\f'
    else if (next === '\r') {
      if (raw[i + 1] === '\n') i++
    } else if (next === '\n') {
      // line continuation
    } else if (/[0-7]/.test(next)) {
      let oct = next
      while (oct.length < 3 && /[0-7]/.test(raw[i + 1] ?? '')) oct += raw[++i]
      out += String.fromCharCode(parseInt(oct, 8) & 0xff)
    } else out += next
  }
  return out
}

/** Bytes of a PDF text string (as latin1 chars) → JS string. */
function decodeTextString(bytes: string): string {
  if (bytes.startsWith('\xfe\xff')) {
    let out = ''
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1))
    return out
  }
  if (bytes.startsWith('\xef\xbb\xbf')) return Buffer.from(bytes.slice(3), 'latin1').toString('utf8')
  return bytes
}

/** The value of `/NM` at the top level of an object's dictionary, or undefined. */
export function nameFromObjectBody(body: string): string | undefined {
  let depth = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '(') {
      i = skipLiteral(body, i) - 1
    } else if (ch === '<' && body[i + 1] === '<') {
      depth++
      i++
    } else if (ch === '>' && body[i + 1] === '>') {
      depth--
      i++
      if (depth <= 0) return undefined
    } else if (ch === '%') {
      const eol = body.slice(i).search(/[\r\n]/)
      if (eol === -1) return undefined
      i += eol
    } else if (ch === '/' && depth === 1 && body.startsWith('/NM', i) && !/[A-Za-z0-9#]/.test(body[i + 3] ?? '')) {
      let j = i + 3
      while (/\s/.test(body[j] ?? '')) j++
      if (body[j] === '(') {
        const end = skipLiteral(body, j)
        return decodeTextString(decodeLiteral(body.slice(j + 1, end - 1)))
      }
      if (body[j] === '<' && body[j + 1] !== '<') {
        const end = body.indexOf('>', j)
        if (end === -1) return undefined
        let hex = body.slice(j + 1, end).replace(/\s+/g, '')
        if (!/^[0-9A-Fa-f]*$/.test(hex)) return undefined
        if (hex.length % 2) hex += '0'
        return decodeTextString(Buffer.from(hex, 'hex').toString('latin1'))
      }
      return undefined
    }
  }
  return undefined
}

/** `"12R"` / `"12R3"` (PDF.js ids) → object number + generation. */
export function parsePdfJsRef(objectId: string): { num: number; gen: number } | null {
  return parseRef(objectId)
}

/**
 * Random access to the objects of a PDF's bytes: the newest version of `num gen obj` (plain, or in a
 * FlateDecode object stream). Built once per file; also used by the incremental writer.
 */
export class PdfRawObjects {
  readonly text: string
  private readonly plain: Map<string, number>
  private streams: Map<number, Located> | null = null

  constructor(bytes: Uint8Array) {
    this.text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1')
    this.plain = indexPlainObjects(this.text)
  }

  /** True when the file is encrypted (strings and streams are ciphertext). */
  get encrypted(): boolean {
    return /\/Encrypt\s/.test(this.text.slice(-65536)) || /\/Encrypt\s/.test(this.text.slice(0, 4096))
  }

  /** Body text of the newest `num gen obj` (between `obj` and `endobj`), or undefined. */
  body(num: number, gen = 0): string | undefined {
    const plainStart = this.plain.get(`${num} ${gen}`)
    let body: string | undefined = plainStart === undefined ? undefined : bodyAt(this.text, plainStart)
    if (gen === 0) {
      this.streams ??= indexObjectStreams(this.text, this.plain)
      const compressed = this.streams.get(num)
      if (compressed && (plainStart === undefined || compressed.position > plainStart)) body = compressed.body
    }
    return body
  }
}

/**
 * `/NM` of each annotation object in `objectIds` (PDF.js ids), keyed by id. Ids that can't be
 * resolved, or have no / an empty name, are simply absent. An encrypted file yields an empty map:
 * its strings are ciphertext, not names.
 */
export function readAnnotationNames(bytes: Uint8Array, objectIds: readonly string[]): Map<string, string> {
  const names = new Map<string, string>()
  if (objectIds.length === 0) return names
  const objects = new PdfRawObjects(bytes)
  if (objects.encrypted) return names
  for (const id of objectIds) {
    const ref = parseRef(id)
    if (!ref) continue
    const body = objects.body(ref.num, ref.gen)
    const name = body === undefined ? undefined : nameFromObjectBody(body)?.trim()
    if (name) names.set(id, name)
  }
  return names
}
