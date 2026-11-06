/**
 * The DLL names a Windows PE executable imports (its import directory), read straight from the file — no dumpbin /
 * objdump needed. Used to refuse an FFmpeg build that needs a DLL Windows does not ship (e.g. MSYS2's
 * libwinpthread-1.dll), both when staging it (stage-ffmpeg.mjs) and in the packaged app (verify-packaged-ffmpeg.mjs).
 */
import fs from 'node:fs'

/** In-box on every Windows 10+ (Electron's minimum), so a binary may import them. Lower-case. */
const SYSTEM_DLLS = new Set(['kernel32.dll', 'bcrypt.dll', 'shell32.dll', 'user32.dll', 'advapi32.dll', 'ole32.dll', 'psapi.dll', 'ws2_32.dll', 'ucrtbase.dll'])

export function isSystemDll(name) {
  const lower = name.toLowerCase()
  return SYSTEM_DLLS.has(lower) || lower.startsWith('api-ms-win-')
}

export function peImports(filePath) {
  const b = fs.readFileSync(filePath)
  if (b.toString('latin1', 0, 2) !== 'MZ') throw new Error(`${filePath}: not a PE file`)
  const pe = b.readUInt32LE(0x3c)
  if (b.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error(`${filePath}: no PE signature`)
  const sections = b.readUInt16LE(pe + 6)
  const optSize = b.readUInt16LE(pe + 20)
  const opt = pe + 24
  const magic = b.readUInt16LE(opt)
  const dataDirs = opt + (magic === 0x20b ? 112 : 96) // PE32+ : PE32
  const importRva = b.readUInt32LE(dataDirs + 8) // data directory 1 = import table
  if (importRva === 0) return []
  const table = opt + optSize
  const toOffset = (rva) => {
    for (let i = 0; i < sections; i += 1) {
      const s = table + i * 40
      const va = b.readUInt32LE(s + 12)
      const size = Math.max(b.readUInt32LE(s + 8), b.readUInt32LE(s + 16))
      if (rva >= va && rva < va + size) return rva - va + b.readUInt32LE(s + 20)
    }
    throw new Error(`${filePath}: RVA 0x${rva.toString(16)} is outside every section`)
  }
  const names = []
  for (let d = toOffset(importRva); ; d += 20) {
    const nameRva = b.readUInt32LE(d + 12)
    if (nameRva === 0) break
    const start = toOffset(nameRva)
    names.push(b.toString('latin1', start, b.indexOf(0, start)))
  }
  return names
}
