/**
 * Spec 016 (FR-004a / FR-006, research R4 / R10), Mobile WebView: a book's file read by ranges.
 *
 * - `bookSource(ctx, bookId)` — a `RandomAccessSource` over the local server's `Range` answers (or `files.readChunk`
 *   in Expo Go); nothing holds or ships the whole file.
 * - `inflateRaw` — `DecompressionStream('deflate-raw')` (Chromium ≥ 103); older WebViews inflate the SAME bytes with
 *   the existing JSZip, by wrapping them in a one-entry ZIP (only that entry's bytes, never the whole book).
 * - `openBookZip(ctx, bookId)` — the ranged ZIP reader of core on that source.
 */
import { openRangedZip, type ArchiveReader, type RandomAccessSource } from '@core'
import type { BridgeContext } from './context'

export async function bookSource(ctx: Pick<BridgeContext, 'content'>, bookId: string): Promise<RandomAccessSource> {
  const first = await ctx.content.readRange(bookId, 0, 1)
  return {
    size: first.sizeBytes,
    read: async (offset, length) => (length === 0 ? new Uint8Array(0) : (await ctx.content.readRange(bookId, offset, length)).data),
  }
}

async function inflateWithStream(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** A one-entry ZIP around already-compressed bytes, so JSZip can inflate them (CRC not checked by JSZip by default). */
function oneEntryZip(compressed: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode('e')
  const local = new Uint8Array(30 + name.length)
  const lv = new DataView(local.buffer)
  lv.setUint32(0, 0x04034b50, true)
  lv.setUint16(4, 20, true)
  lv.setUint16(8, 8, true)
  lv.setUint32(18, compressed.length, true)
  lv.setUint32(22, 0xffffffff, true) // uncompressed size unknown to us; JSZip does not need it to inflate
  lv.setUint16(26, name.length, true)
  local.set(name, 30)
  const central = new Uint8Array(46 + name.length)
  const cv = new DataView(central.buffer)
  cv.setUint32(0, 0x02014b50, true)
  cv.setUint16(4, 20, true)
  cv.setUint16(6, 20, true)
  cv.setUint16(10, 8, true)
  cv.setUint32(20, compressed.length, true)
  cv.setUint32(24, 0xffffffff, true)
  cv.setUint16(28, name.length, true)
  central.set(name, 46)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, 1, true)
  ev.setUint16(10, 1, true)
  ev.setUint32(12, central.length, true)
  ev.setUint32(16, local.length + compressed.length, true)
  const out = new Uint8Array(local.length + compressed.length + central.length + end.length)
  out.set(local, 0)
  out.set(compressed, local.length)
  out.set(central, local.length + compressed.length)
  out.set(end, local.length + compressed.length + central.length)
  return out
}

async function inflateWithJsZip(data: Uint8Array): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(oneEntryZip(data))
  const entry = zip.file('e')
  if (!entry) throw new Error('inflate failed')
  return entry.async('uint8array')
}

export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'function') {
    try {
      return await inflateWithStream(data)
    } catch {
      // 'deflate-raw' is missing below Chromium 103: fall through to JSZip on the same bytes.
    }
  }
  return inflateWithJsZip(data)
}

export async function openBookZip(ctx: Pick<BridgeContext, 'content'>, bookId: string): Promise<ArchiveReader> {
  return openRangedZip(await bookSource(ctx, bookId), inflateRaw)
}
