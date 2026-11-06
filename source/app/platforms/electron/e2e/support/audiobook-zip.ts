/** Synthetic audiobook ZIPs for the E2E specs (generated here; nothing copyrighted, nothing committed as a binary). */

const FRAME = (() => {
  const f = Buffer.alloc(417)
  f[0] = 0xff
  f[1] = 0xfb
  f[2] = 0x90
  return f
})()

/** MPEG-1 Layer III frames of digital silence; `seed` makes every track a different file (different hash). */
export function mp3Bytes(frames: number, seed: number): Buffer {
  const body = Buffer.concat(Array(frames).fill(FRAME))
  body.writeUInt32BE(seed >>> 0, body.length - 8)
  return body
}

export const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64')

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(b: Buffer): number {
  let c = 0xffffffff
  for (const x of b) c = (CRC_TABLE[(c ^ x) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A ZIP with every entry stored (no compression), names used verbatim. */
export function buildZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const crc = crc32(e.data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0x800, 6)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(e.data.length, 18)
    lh.writeUInt32LE(e.data.length, 22)
    lh.writeUInt16LE(name.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0x800, 8)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(e.data.length, 20)
    ch.writeUInt32LE(e.data.length, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(offset, 42)
    locals.push(lh, name, e.data)
    centrals.push(ch, name)
    offset += 30 + name.length + e.data.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

/** `count` numbered tracks (`01 - Part 1.mp3` …) plus a cover image and a README, ~`kbPerTrack` KB each. */
export function audiobookZip(count: number, kbPerTrack = 100): Buffer {
  const frames = Math.max(10, Math.round((kbPerTrack * 1024) / 417))
  return buildZip([
    ...Array.from({ length: count }, (_, i) => ({
      name: `Book/${String(i + 1).padStart(2, '0')} - Part ${i + 1}.mp3`,
      data: mp3Bytes(frames, i + 1),
    })),
    { name: 'Book/cover.png', data: PNG1 },
    { name: 'Book/README.txt', data: Buffer.from('synthetic audiobook for the E2E suite') },
  ])
}
