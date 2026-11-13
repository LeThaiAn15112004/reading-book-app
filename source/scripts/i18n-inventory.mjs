#!/usr/bin/env node
/**
 * Spec 012 inventory: where interface text is still written as a literal instead of coming from the i18n catalogue.
 * A development aid (it never fails the build — the lint rule and the release gate do).
 *
 *   npm run i18n:inventory                 summary per file (count + first examples)
 *   npm run i18n:inventory -- --files      .tsx files the lint rule flags (pending headers included), one per line
 *   npm run i18n:inventory -- --json       everything as JSON
 *   npm run i18n:inventory -- --only <path-prefix>
 *
 * `.tsx` files under source/app (screens, components, hooks, App.tsx) are checked with the REAL `readmate/no-ui-literals`
 * rule (pending headers ignored); `.ts` files (stores, helpers, Electron Main, core) with a text heuristic: a quoted
 * string that starts with a capital letter and has at least two words, outside `console.*`, imports and tests.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { readmatePlugin, PENDING_HEADER } from './eslint-rules/no-ui-literals.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const mode = args.includes('--json') ? 'json' : args.includes('--files') ? 'files' : 'summary'
const onlyIndex = args.indexOf('--only')
const only = onlyIndex >= 0 ? args[onlyIndex + 1]?.replaceAll('\\', '/') : undefined

export const UI_TSX_GLOBS = [
  'source/app/screens/**/*.tsx',
  'source/app/components/**/*.tsx',
  'source/app/hooks/**/*.tsx',
  'source/app/App.tsx',
]

const TS_ROOTS = ['source/app', 'source/core/src']
const SKIP_DIR = /(^|\/)(node_modules|dist|dist-electron|release|e2e|spikes|tests|native|i18n|catalogue|web-dist)(\/|$)/
const rel = (file) => path.relative(ROOT, file).replaceAll('\\', '/')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIR.test(rel(full))) walk(full, out)
    } else if (/\.ts$/.test(entry.name) && !/\.(test|d)\.ts$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const STRING = /(['"`])((?:\\.|(?!\1).)*)\1/g
const LOOKS_LIKE_TEXT = /^[A-Z][a-z’']*(?:[ ,][A-Za-z…’'.,:!?()-]+)+$/
const SKIP_LINE = /console\.|^\s*import |^\s*export \* from|^\s*\/\/|^\s*\/?\*|className|data-testid|throw new Error\(`?\[/
/**
 * Developer-facing text: errors thrown or logged with a code the UI translates, HTTP bodies of the app's own protocols.
 * They are diagnostics, not interface text (spec 012 FR-001 scope).
 */
const DEVELOPER_TEXT = /new [A-Z]\w*Error\(|\bError\(|\.(warn|error|info|debug)\(|new Response\(|toSdkError\(|\bstorage\('|\bfail\('[A-Z_]+',|commitFailure\(|\bfailure\('[A-Za-z_]+', '[A-Z]/

/** Already translated: the quoted text on the line is a parameter (a product name), not a message. */
const TRANSLATED = /\b(tConnector|tMain|translate|getT\(\)|t)\('[a-z][A-Za-z]*\./

function heuristicFindings(file) {
  const findings = []
  const source = fs.readFileSync(file, 'utf8')
  // A whole file of non-interface text (sample data, product / font / language names), with its reason.
  if (/i18n-ignore-file: \S/.test(source)) return findings
  source
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (SKIP_LINE.test(line) || DEVELOPER_TEXT.test(line) || TRANSLATED.test(line) || /i18n-ignore:/.test(line)) return
      for (const match of line.matchAll(STRING)) {
        const text = match[2]
        if (text.includes('${') || !LOOKS_LIKE_TEXT.test(text.trim())) continue
        findings.push({ line: index + 1, text })
      }
    })
  return findings
}

async function tsxFindings() {
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.tsx'],
        languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { readmate: readmatePlugin },
        rules: { 'readmate/no-ui-literals': ['error', { includePending: true }] },
      },
    ],
  })
  const results = await eslint.lintFiles(UI_TSX_GLOBS)
  return results.map((r) => ({
    file: rel(r.filePath),
    pending: PENDING_HEADER.exec(fs.readFileSync(r.filePath, 'utf8'))?.[1] ?? null,
    findings: r.messages
      .filter((m) => m.ruleId === 'readmate/no-ui-literals')
      .map((m) => ({ line: m.line, text: m.message.match(/"([^"]*)"/)?.[1] ?? m.message })),
  }))
}

const tsx = await tsxFindings()
const ts = TS_ROOTS.flatMap((root) => walk(path.join(ROOT, root))).map((file) => ({
  file: rel(file),
  pending: null,
  findings: heuristicFindings(file),
}))
const all = [...tsx, ...ts]
  .filter((r) => r.findings.length > 0)
  .filter((r) => !only || r.file.startsWith(only))
  .sort((a, b) => a.file.localeCompare(b.file))

if (mode === 'json') {
  console.log(JSON.stringify(all, null, 2))
} else if (mode === 'files') {
  for (const r of all) if (r.file.endsWith('.tsx')) console.log(r.file)
} else {
  let total = 0
  for (const r of all) {
    total += r.findings.length
    const tag = r.pending ? ` [pending: ${r.pending}]` : ''
    const sample = r.findings
      .slice(0, 3)
      .map((f) => `L${f.line} "${f.text}"`)
      .join(', ')
    console.log(`${String(r.findings.length).padStart(4)}  ${r.file}${tag}  ${sample}`)
  }
  console.log(`\n${total} candidate texts in ${all.length} files (heuristic for .ts; lint rule for .tsx)`)
}
