/**
 * Base64, UUID and hex helpers for the host (spec 008). Plain TypeScript: Hermes' `atob` / `btoa` work on binary
 * strings and would need a copy per byte anyway, and the same code runs in the vitest suite on Node.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1)
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i
  return table
})()

const CODES = Uint8Array.from(ALPHABET, (c) => c.charCodeAt(0))
const PAD = 61 // '='

/** Builds the output as character codes in blocks: no string concatenation per character (slow on Hermes). */
export function bytesToBase64(bytes: Uint8Array): string {
  const out = new Uint8Array(Math.ceil(bytes.length / 3) * 4)
  let o = 0
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out[o++] = CODES[n >> 18]!
    out[o++] = CODES[(n >> 12) & 63]!
    out[o++] = CODES[(n >> 6) & 63]!
    out[o++] = CODES[n & 63]!
  }
  const rest = bytes.length - i
  if (rest > 0) {
    const n = (bytes[i]! << 16) | (rest === 2 ? bytes[i + 1]! << 8 : 0)
    out[o++] = CODES[n >> 18]!
    out[o++] = CODES[(n >> 12) & 63]!
    out[o++] = rest === 2 ? CODES[(n >> 6) & 63]! : PAD
    out[o++] = PAD
  }
  let text = ''
  const BLOCK = 0x8000
  for (let k = 0; k < out.length; k += BLOCK) text += String.fromCharCode.apply(null, out.subarray(k, k + BLOCK) as unknown as number[])
  return text
}

/** Strict: whitespace, a wrong length or a foreign character is refused (undefined), never guessed. */
export function base64ToBytes(text: string): Uint8Array | undefined {
  if (text.length % 4 !== 0) return undefined
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const out = new Uint8Array((text.length / 4) * 3 - padding)
  const body = text.length - padding
  let o = 0
  for (let i = 0; i < text.length; i += 4) {
    let n = 0
    for (let k = 0; k < 4; k++) {
      const at = i + k
      const c = text.charCodeAt(at)
      let v: number
      if (at >= body) {
        if (c !== PAD) return undefined
        v = 0
      } else {
        v = c < 128 ? LOOKUP[c]! : -1
        if (v < 0) return undefined
      }
      n = (n << 6) | v
    }
    if (o < out.length) out[o++] = n >> 16
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** The only shape of id the file service accepts in a path: nothing else can name a folder. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0')
  return out
}
