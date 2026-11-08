// Spec 010 T043 — minimal .ico writer with PNG-compressed entries (contracts/store-icons.md "icon.ico").
// Windows Vista+ reads PNG payloads in ICO files; every entry here is a PNG (no BMP/AND mask needed).
//
// Layout: ICONDIR (6 bytes: reserved 0, type 1, count) + one 16-byte ICONDIRENTRY per image
// (width, height — 0 means 256 —, colorCount 0, reserved 0, planes 1, bitCount 32, bytesInRes, imageOffset)
// followed by the PNG payloads in the same order.

const DIR_BYTES = 6
const ENTRY_BYTES = 16

/** `entries`: `{ size, png: Buffer }[]` (square images, 1–256 px). Returns the .ico bytes. */
export function writeIco(entries) {
  const header = Buffer.alloc(DIR_BYTES + ENTRY_BYTES * entries.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = header.length
  entries.forEach(({ size, png }, i) => {
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error(`ICO entry size ${size} must be 1–256`)
    const at = DIR_BYTES + ENTRY_BYTES * i
    header.writeUInt8(size === 256 ? 0 : size, at)
    header.writeUInt8(size === 256 ? 0 : size, at + 1)
    header.writeUInt8(0, at + 2)
    header.writeUInt8(0, at + 3)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...entries.map((e) => e.png)])
}

/** Reads the directory of an .ico → `{ size, bytes, offset }[]` (used by the checks and tests). */
export function readIcoDirectory(buf) {
  if (buf.length < DIR_BYTES || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('not an .ico file')
  const count = buf.readUInt16LE(4)
  return Array.from({ length: count }, (_, i) => {
    const at = DIR_BYTES + ENTRY_BYTES * i
    const w = buf.readUInt8(at)
    return { size: w === 0 ? 256 : w, bytes: buf.readUInt32LE(at + 8), offset: buf.readUInt32LE(at + 12) }
  })
}
