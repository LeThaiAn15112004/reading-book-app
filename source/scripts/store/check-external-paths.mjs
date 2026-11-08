// Spec 010 T029 — every shell.* call that can hand an APP-OWNED path to another program goes through
// pathForOtherApps (contracts/packaged-runtime.md "Paths given to other apps", research R7).
//
//   node source/scripts/store/check-external-paths.mjs        (part of `npm run check`)
//
// Scans source/app/platforms/electron/**/*.ts (not spikes/, e2e/) for:
//   shell.openPath(…) / shell.showItemInFolder(…)  → the argument must start with pathForOtherApps(
//   shell.openExternal(…)                         → only file: URLs need it (pathToFileURL(…), 'file:…'); web and
//                                                    ms-settings: URLs are fine
// A call on a path the USER picked (never inside userData) is exempted by `// external-path: user-chosen` on the
// line before it. Comment lines are ignored. Lists every unmapped call (file:line), exit 1 on any.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CALL = /\bshell\.(openPath|showItemInFolder|openExternal)\s*\(/g
const EXEMPT = /\/\/\s*external-path:\s*user-chosen\b/
const FILE_URL = /pathToFileURL\s*\(|['"`]file:/

/** The text of the call's argument list (balanced parentheses, may span lines), from just after "(". */
function argumentText(source, start) {
  let depth = 1
  for (let i = start; i < source.length; i++) {
    const c = source[i]
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return source.slice(start, i)
  }
  return source.slice(start)
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length

/** `files`: `{ path, text }[]` → `{ file, line, call, reason }[]` of the calls that are not mapped. */
export function findUnmappedShellCalls(files) {
  const hits = []
  for (const { path: file, text } of files) {
    const lines = text.split('\n')
    for (const m of text.matchAll(CALL)) {
      const line = lineOf(text, m.index)
      const lineText = lines[line - 1].trim()
      if (lineText.startsWith('//') || lineText.startsWith('*') || lineText.startsWith('/*')) continue
      if (line >= 2 && EXEMPT.test(lines[line - 2])) continue
      const arg = argumentText(text, m.index + m[0].length).trim()
      const kind = m[1]
      if (kind === 'openExternal') {
        if (!FILE_URL.test(arg) || arg.includes('pathForOtherApps(')) continue
        hits.push({ file, line, call: `shell.${kind}`, reason: 'file: URL without pathForOtherApps' })
        continue
      }
      if (arg.startsWith('pathForOtherApps(')) continue
      hits.push({ file, line, call: `shell.${kind}`, reason: 'path not wrapped in pathForOtherApps(…)' })
    }
  }
  return hits
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['spikes', 'e2e', 'node_modules', 'dist', 'dist-electron', 'release', 'build-resources'].includes(entry.name)) continue
      walk(p, out)
    } else if (/\.ts$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(p)
    }
  }
  return out
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(here, '../../..')
  const host = path.join(repoRoot, 'source/app/platforms/electron')
  const files = walk(host).map((p) => ({ path: path.relative(repoRoot, p).replaceAll('\\', '/'), text: readFileSync(p, 'utf8') }))
  const hits = findUnmappedShellCalls(files)
  if (hits.length > 0) {
    console.error(`check-external-paths: ${hits.length} shell call(s) may hand a virtualised Store path to another app:`)
    for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.call} — ${h.reason}`)
    console.error('  Wrap the path in pathForOtherApps(…) (files/external-path.ts), or mark a user-chosen path with')
    console.error('  `// external-path: user-chosen` on the line before.')
    return 1
  }
  console.log(`check-external-paths: OK (${files.length} files)`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
