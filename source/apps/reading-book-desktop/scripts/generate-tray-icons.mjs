/**
 * Generates the System Tray icons (an open book) into public/tray/:
 *   tray.png / tray@2x.png                  — amber, Windows / Linux tray
 *   trayTemplate.png / trayTemplate@2x.png  — black + alpha, macOS menu bar (template image)
 *
 * Plain Node (zlib PNG encoder, 4×4 supersampling) so no image tooling is needed.
 * Run: node scripts/generate-tray-icons.mjs
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'tray')

/** Two pages of an open book in unit coordinates (y down), with a gap for the spine. */
const PAGES = [
  [
    [0.06, 0.2],
    [0.47, 0.28],
    [0.47, 0.88],
    [0.06, 0.8],
  ],
  [
    [0.53, 0.28],
    [0.94, 0.2],
    [0.94, 0.8],
    [0.53, 0.88],
  ],
]

function insidePolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Fraction (0–1) of the pixel covered by the book. */
function coverage(px, py, size) {
  const n = 4
  let hits = 0
  for (let sy = 0; sy < n; sy++) {
    for (let sx = 0; sx < n; sx++) {
      const x = (px + (sx + 0.5) / n) / size
      const y = (py + (sy + 0.5) / n) / size
      if (PAGES.some((poly) => insidePolygon(x, y, poly))) hits++
    }
  }
  return hits / (n * n)
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function render(size, [r, g, b]) {
  const rgba = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = Math.round(coverage(x, y, size) * 255)
    }
  }
  return encodePng(size, rgba)
}

const AMBER = [0xf5, 0x9e, 0x0b] // theme accent (orange)
const BLACK = [0, 0, 0]

fs.mkdirSync(OUT_DIR, { recursive: true })
for (const [name, size, color] of [
  ['tray.png', 16, AMBER],
  ['tray@2x.png', 32, AMBER],
  ['trayTemplate.png', 16, BLACK],
  ['trayTemplate@2x.png', 32, BLACK],
]) {
  fs.writeFileSync(path.join(OUT_DIR, name), render(size, color))
  console.log(`wrote public/tray/${name}`)
}
