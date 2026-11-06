import { normalizeTxtText } from '@reading-book/book-reader-sdk'

export type MdSource = {
  /** Canonical text: BOM dropped, `\n` line breaks. Empty string for an empty file. */
  text: string
  /** The bytes were not valid UTF-8; undecodable sequences became U+FFFD (the user is told). */
  lossy: boolean
}

/**
 * Bytes of a .md file → text. UTF-8 (with or without BOM); invalid sequences are replaced rather
 * than failing, and `lossy` is set so the reader can say so instead of silently altering the text.
 * Nothing is truncated here — the size limit is enforced in Main before the bytes are sent.
 */
export function decodeMdSource(bytes: ArrayBuffer): MdSource {
  let lossy = false
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    lossy = true
    decoded = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(bytes)
  }
  return { text: normalizeTxtText(decoded), lossy }
}

/** `rb-md-asset://local/{bookId}/{path}` — served by Main (electron/md/md-asset-protocol.ts). */
export function mdAssetUrl(bookId: string, relativePath: string): string {
  const path = relativePath.split('/').map(encodeURIComponent).join('/')
  return `rb-md-asset://local/${encodeURIComponent(bookId)}/${path}`
}
