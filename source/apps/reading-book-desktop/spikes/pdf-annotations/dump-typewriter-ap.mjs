/** Debug helper: prints the decoded appearance stream of the first Typewriter note in a PDF. node dump-typewriter-ap.mjs file.pdf */
import fs from 'node:fs'
import { inflateSync } from 'node:zlib'
const str = fs.readFileSync(process.argv[2]).toString('latin1')
for (const m of str.matchAll(/\/BBox \[0 0[^\n]*?\/Length (\d+) >>\nstream\n/g)) {
  const raw = Buffer.from(str.slice(m.index + m[0].length, m.index + m[0].length + Number(m[1])), 'latin1')
  console.log(inflateSync(raw).toString('latin1'))
  break
}
