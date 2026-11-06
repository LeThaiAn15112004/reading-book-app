#!/usr/bin/env node
// Spec 009 FR-010a (T040, contracts/platform-adapters.md rule 6): every platform concern in `source/app/platforms/`
// has exactly two files, `<concern>.electron.ts(x)` and `<concern>.native.ts(x)`, that export the same names.
//
//   node source/scripts/check-platform-adapters.mjs
//
// Exports are read from the TypeScript AST (no type information): declarations, `export { a as b }`, `export default`.
// `export * from` cannot be compared by name, so it is refused in an adapter.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SUFFIX = /^(.+)\.(electron|native)\.(tsx?)$/

/** Names a module exports; `star` is true when it has an `export * from`. */
export function exportedNames(file, text = readFileSync(file, 'utf8')) {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const names = new Set()
  let star = false
  const has = (node, flag) => (ts.getCombinedModifierFlags(node) & flag) !== 0
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node)) {
      if (!node.exportClause) star = true
      else if (ts.isNamedExports(node.exportClause)) for (const e of node.exportClause.elements) names.add(e.name.text)
      else names.add(node.exportClause.name.text)
    } else if (ts.isExportAssignment(node)) {
      names.add('default')
    } else if (has(node, ts.ModifierFlags.Export)) {
      if (has(node, ts.ModifierFlags.Default)) names.add('default')
      else if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text)
      } else if (node.name && ts.isIdentifier(node.name)) names.add(node.name.text)
    }
  }
  return { names: [...names].sort(), star }
}

/** Violations of the platform-adapter contract under `<root>/source/app/platforms`. */
export function checkPlatformAdapters(root = repoRoot) {
  const dir = path.join(root, 'source/app/platforms')
  const violations = []
  const concerns = new Map()
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const m = entry.isFile() ? SUFFIX.exec(entry.name) : null
      if (!m) continue
      const [, concern, side] = m
      const sides = concerns.get(concern) ?? {}
      if (sides[side]) violations.push(`${concern}: two ${side} files (${sides[side]} and ${entry.name})`)
      else sides[side] = entry.name
      concerns.set(concern, sides)
    }
  }
  for (const [concern, sides] of concerns) {
    if (!sides.electron || !sides.native) {
      violations.push(`${concern}: only ${sides.electron ?? sides.native} exists; a concern needs both .electron and .native`)
      continue
    }
    const a = exportedNames(path.join(dir, sides.electron))
    const b = exportedNames(path.join(dir, sides.native))
    for (const [file, e] of [[sides.electron, a], [sides.native, b]]) {
      if (e.star) violations.push(`${concern}: ${file} uses "export * from", whose names cannot be compared`)
    }
    const onlyA = a.names.filter((n) => !b.names.includes(n))
    const onlyB = b.names.filter((n) => !a.names.includes(n))
    if (onlyA.length || onlyB.length) {
      violations.push(`${concern}: exports differ (only in ${sides.electron}: ${onlyA.join(', ') || '-'}; only in ${sides.native}: ${onlyB.join(', ') || '-'})`)
    }
  }
  return { concerns: concerns.size, violations }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { concerns, violations } = checkPlatformAdapters()
  for (const v of violations) console.error(`[platform-adapters] ${v}`)
  if (violations.length) {
    console.error(`check-platform-adapters: ${violations.length} violation(s)`)
    process.exitCode = 1
  } else {
    console.log(`check-platform-adapters: OK (${concerns} concern${concerns === 1 ? '' : 's'})`)
  }
}
