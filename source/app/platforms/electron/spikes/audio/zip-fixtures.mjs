/** Synthetic media and a tiny ZIP writer for the audiobook ZIP spikes (nothing copyrighted, nothing binary committed). */
import zlib from 'node:zlib'

const FRAME = Buffer.alloc(417)
FRAME[0] = 0xff
FRAME[1] = 0xfb
FRAME[2] = 0x90

/** MPEG-1 Layer III 128 kbps / 44.1 kHz frames of silence. `seed` makes distinct tracks hash differently. */
export function mp3(frames = 40, seed = 0) {
  const body = Buffer.concat(Array(frames).fill(FRAME))
  // keep every frame header intact; vary the payload of the last frame so the bytes (and sha256) differ per seed
  if (seed) body.writeUInt32BE(seed >>> 0, body.length - 8)
  return body
}

/** 1 s of 8 kHz mono 16-bit PCM silence (`seed` varies one sample). */
export function wav(seed = 0) {
  const data = Buffer.alloc(8000 * 2)
  if (seed) data.writeInt16LE(seed & 0x7fff, 100)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(8000, 24)
  h.writeUInt32LE(16000, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

export const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64')
export const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9])

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (b) => {
  let c = 0xffffffff
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** entry: { name, data?, deflate?, mode?, declaredSize?, flags? } — name is used verbatim. */
export function buildZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const e of entries) {
    const data = e.data ?? Buffer.alloc(0)
    const body = e.deflate ? zlib.deflateRawSync(data) : data
    const name = Buffer.from(e.name, 'utf8')
    const flags = 0x800 | (e.flags ?? 0)
    const usize = e.declaredSize ?? data.length
    const method = e.deflate ? 8 : 0
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(flags, 6)
    lh.writeUInt16LE(method, 8)
    lh.writeUInt32LE(crc32(data), 14)
    lh.writeUInt32LE(body.length, 18)
    lh.writeUInt32LE(usize, 22)
    lh.writeUInt16LE(name.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(((e.mode ? 3 : 0) << 8) | 20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(flags, 8)
    ch.writeUInt16LE(method, 10)
    ch.writeUInt32LE(crc32(data), 16)
    ch.writeUInt32LE(body.length, 20)
    ch.writeUInt32LE(usize, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(((e.mode ?? 0) << 16) >>> 0, 38)
    ch.writeUInt32LE(offset, 42)
    locals.push(lh, name, body)
    centrals.push(ch, name)
    offset += 30 + name.length + body.length
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
