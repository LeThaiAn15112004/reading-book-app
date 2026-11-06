/**
 * Just enough ASN.1 DER/BER reading to walk a CMS `SignedData` and an X.509 certificate.
 * Read-only, single-byte tags only (CMS / X.509 use nothing else), bounds-checked everywhere so a
 * hostile file can only make parsing throw — never read out of range or loop forever.
 */

export interface DerNode {
  tag: number
  /** Offset of the tag byte in `buf`. */
  start: number
  contentStart: number
  /** Offset one past the last content byte (for indefinite length: past the end-of-contents). */
  end: number
  /** Offset one past the last *content* byte (excludes the BER end-of-contents octets). */
  contentEnd: number
  buf: Buffer
}

export class DerError extends Error {}

const MAX_DEPTH = 32

export function readNode(buf: Buffer, offset: number, limit = buf.length, depth = 0): DerNode {
  if (depth > MAX_DEPTH) throw new DerError('ASN.1 nesting too deep')
  if (offset < 0 || offset + 2 > limit) throw new DerError('ASN.1 truncated')
  const tag = buf[offset]
  if ((tag & 0x1f) === 0x1f) throw new DerError('ASN.1 high tag numbers are not supported')

  const first = buf[offset + 1]
  let contentStart = offset + 2

  if (first === 0x80) {
    // BER indefinite length (constructed only): children until 00 00.
    if ((tag & 0x20) === 0) throw new DerError('ASN.1 indefinite length on a primitive')
    let cursor = contentStart
    for (;;) {
      if (cursor + 2 > limit) throw new DerError('ASN.1 unterminated indefinite length')
      if (buf[cursor] === 0 && buf[cursor + 1] === 0) {
        return { tag, start: offset, contentStart, contentEnd: cursor, end: cursor + 2, buf }
      }
      cursor = readNode(buf, cursor, limit, depth + 1).end
    }
  }

  let length = first
  if (first & 0x80) {
    const lengthBytes = first & 0x7f
    if (lengthBytes === 0 || lengthBytes > 4) throw new DerError('ASN.1 unsupported length')
    if (contentStart + lengthBytes > limit) throw new DerError('ASN.1 truncated')
    length = 0
    for (let i = 0; i < lengthBytes; i++) length = length * 256 + buf[contentStart + i]
    contentStart += lengthBytes
  }
  const end = contentStart + length
  if (end > limit) throw new DerError('ASN.1 content overruns its container')
  return { tag, start: offset, contentStart, contentEnd: end, end, buf }
}

/** Direct children of a constructed node, in order. */
export function children(node: DerNode, depth = 0): DerNode[] {
  if ((node.tag & 0x20) === 0) throw new DerError('ASN.1 node is not constructed')
  const out: DerNode[] = []
  let cursor = node.contentStart
  while (cursor < node.contentEnd) {
    const child = readNode(node.buf, cursor, node.contentEnd, depth + 1)
    out.push(child)
    cursor = child.end
  }
  return out
}

/** Content bytes (no tag/length) of a node. */
export function contentOf(node: DerNode): Buffer {
  return node.buf.subarray(node.contentStart, node.contentEnd)
}

/** The node's full encoding (tag + length + content). */
export function encodingOf(node: DerNode): Buffer {
  return node.buf.subarray(node.start, node.end)
}

export const TAG = {
  integer: 0x02,
  octetString: 0x04,
  oid: 0x06,
  utcTime: 0x17,
  generalizedTime: 0x18,
  sequence: 0x30,
  set: 0x31,
  /** [0] constructed, context-specific. */
  ctx0: 0xa0,
  ctx1: 0xa1,
  /** [0] primitive (IMPLICIT OCTET STRING, e.g. SubjectKeyIdentifier). */
  ctx0Primitive: 0x80,
} as const

export function decodeOid(node: DerNode): string {
  if (node.tag !== TAG.oid) throw new DerError('ASN.1 expected OBJECT IDENTIFIER')
  const bytes = contentOf(node)
  if (bytes.length === 0) throw new DerError('ASN.1 empty OBJECT IDENTIFIER')
  const parts: number[] = []
  let value = 0
  for (let i = 0; i < bytes.length; i++) {
    value = value * 128 + (bytes[i] & 0x7f)
    if ((bytes[i] & 0x80) === 0) {
      if (parts.length === 0) {
        const first = Math.min(Math.floor(value / 40), 2)
        parts.push(first, value - first * 40)
      } else {
        parts.push(value)
      }
      value = 0
    }
  }
  return parts.join('.')
}

/** UTCTime / GeneralizedTime → ISO-8601, or undefined when it is not a plain `…Z` time. */
export function decodeTime(node: DerNode): string | undefined {
  const text = contentOf(node).toString('latin1')
  let year: number
  let rest: string
  if (node.tag === TAG.utcTime) {
    const yy = /^(\d{2})/.exec(text)
    if (!yy) return undefined
    year = Number(yy[1]) >= 50 ? 1900 + Number(yy[1]) : 2000 + Number(yy[1])
    rest = text.slice(2)
  } else if (node.tag === TAG.generalizedTime) {
    const yyyy = /^(\d{4})/.exec(text)
    if (!yyyy) return undefined
    year = Number(yyyy[1])
    rest = text.slice(4)
  } else {
    return undefined
  }
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z$/.exec(rest)
  if (!m) return undefined
  const [, month, day, hour, minute, second] = m
  const date = new Date(
    Date.UTC(year, Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second ?? 0)),
  )
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}
