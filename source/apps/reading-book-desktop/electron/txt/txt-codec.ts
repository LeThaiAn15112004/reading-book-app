import { detectTxtBom, normalizeTxtText } from '@reading-book/book-reader-sdk'

export interface DecodedTxt {
  /** Canonical text: no BOM, `\n` line breaks (`txt/txt-text.ts` in the SDK). */
  text: string
  /** Label of the decoder that produced it. */
  encoding: string
  /** True when the bytes weren't valid UTF-8 and were read as Windows-1252 (accents may be off). */
  legacy: boolean
}

/** BOM-less UTF-16 of mostly-ASCII text has a zero byte in every other position. */
function guessUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const sample = Math.min(bytes.length, 4096) & ~1
  if (sample < 4) return null
  let evenZeros = 0
  let oddZeros = 0
  for (let i = 0; i < sample; i += 2) {
    if (bytes[i] === 0) evenZeros++
    if (bytes[i + 1] === 0) oddZeros++
  }
  const pairs = sample / 2
  if (oddZeros > pairs * 0.4 && evenZeros < pairs * 0.05) return 'utf-16le'
  if (evenZeros > pairs * 0.4 && oddZeros < pairs * 0.05) return 'utf-16be'
  return null
}

/**
 * Bytes of a TXT file → canonical text. A byte-order mark decides the encoding; without one the
 * file is UTF-8 when it is valid UTF-8 (the usual case, Vietnamese included), UTF-16 when it looks
 * like it, and otherwise Windows-1252 — a guess, reported through `legacy` so the reader can say so.
 * Legacy Vietnamese code pages (TCVN3, VNI) are font-dependent and not decodable; they show as mojibake.
 */
export function decodeTxtBytes(bytes: Uint8Array): DecodedTxt {
  const bom = detectTxtBom(bytes)
  if (bom) {
    const text = new TextDecoder(bom.encoding).decode(bytes.subarray(bom.length))
    return { text: normalizeTxtText(text), encoding: bom.encoding, legacy: false }
  }
  const utf16 = guessUtf16(bytes)
  if (utf16) {
    return { text: normalizeTxtText(new TextDecoder(utf16).decode(bytes)), encoding: utf16, legacy: false }
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text: normalizeTxtText(text), encoding: 'utf-8', legacy: false }
  } catch {
    return { text: normalizeTxtText(new TextDecoder('windows-1252').decode(bytes)), encoding: 'windows-1252', legacy: true }
  }
}
