/** T004: licence/fsType/Vietnamese coverage of assets/fonts/typewriter/*.ttf. Run: node --experimental-transform-types spikes/pdf-annotations/check-typewriter-fonts.mjs */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseTrueType } from '../../electron/pdf-sync/pdf-font-embed.ts'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts/typewriter')
const vowels = [...'aăâeêioôơuưy']
const marks = ['̀', '̉', '̃', '́', '̣']
const required = new Set(['đ', 'Đ'])
for (const v of vowels) {
  for (const c of [v, v.toUpperCase()]) {
    required.add(c)
    for (const m of marks) required.add(c.normalize('NFD').concat(m).normalize('NFC'))
  }
}
const cps = [...required].map((s) => s.codePointAt(0))
let bad = 0
for (const f of readdirSync(dir).filter((n) => n.endsWith('.ttf')).sort()) {
  const face = parseTrueType(new Uint8Array(readFileSync(path.join(dir, f))))
  const missing = cps.filter((cp) => !face.hasGlyph(cp)).map((cp) => String.fromCodePoint(cp))
  const embedOk = (face.fsType & 0x0002) === 0
  if (missing.length || !embedOk) bad++
  console.log(`${f.padEnd(26)} fsType=${face.fsType} embed=${embedOk ? 'ok' : 'RESTRICTED'} weight=${face.weightClass} italic=${face.italicAngle} upm=${face.unitsPerEm} glyphs=${face.numGlyphs} vi=${cps.length - missing.length}/${cps.length}${missing.length ? ' MISSING ' + missing.join('') : ''}`)
}
process.exit(bad ? 1 : 0)
