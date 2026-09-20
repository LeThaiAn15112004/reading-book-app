// Minimal ZIP writer/reader on node:zlib — enough to build an EPUB fixture and to implement the
// SDK's ArchiveAdapter port without any npm dependency. A real desktop host would wrap JSZip
// instead (see examples/electron-host/main/adapters.ts). No ZIP64, no encryption.
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** @param {{ name: string, data: string | Uint8Array, store?: boolean }[]} entries */
export function createZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data
    const method = entry.store ? 0 : 8
    const body = method === 8 ? deflateRawSync(raw) : raw
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + body.length
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, ...centrals, end]))
}

/** ArchiveAdapter implementation for the SDK. */
export const nodeZipArchive = {
  async open(bytes) {
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let eocd = -1
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new Error('Not a ZIP archive')

    const count = buf.readUInt16LE(eocd + 10)
    let ptr = buf.readUInt32LE(eocd + 16)
    const entries = new Map()
    for (let i = 0; i < count; i += 1) {
      const method = buf.readUInt16LE(ptr + 10)
      const compressedSize = buf.readUInt32LE(ptr + 20)
      const nameLength = buf.readUInt16LE(ptr + 28)
      const extraLength = buf.readUInt16LE(ptr + 30)
      const commentLength = buf.readUInt16LE(ptr + 32)
      const localOffset = buf.readUInt32LE(ptr + 42)
      const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLength)
      entries.set(name, { method, compressedSize, localOffset })
      ptr += 46 + nameLength + extraLength + commentLength
    }

    const readBytes = async (path) => {
      const entry = entries.get(path)
      if (!entry) return null
      const start =
        entry.localOffset + 30 + buf.readUInt16LE(entry.localOffset + 26) + buf.readUInt16LE(entry.localOffset + 28)
      const body = buf.subarray(start, start + entry.compressedSize)
      return new Uint8Array(entry.method === 8 ? inflateRawSync(body) : body)
    }

    return {
      listEntries: () => [...entries.keys()],
      readBytes,
      readText: async (path) => {
        const bytes = await readBytes(path)
        return bytes ? decoder.decode(bytes) : null
      },
    }
  },
}
