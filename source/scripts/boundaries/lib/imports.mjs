// Shared helpers for the boundary checks (spec 008, US2). Imports are read from the TypeScript AST, never resolved
// through node_modules, so a check gives the same answer whatever is installed or hoisted.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')

export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const coreDir = path.join(sourceRoot, 'core')
export const appDir = path.join(sourceRoot, 'app')
export const sdkDir = coreDir
// The Desktop host (Main, Preload, workers) lives inside the shared UI folder since spec 009 T047.
export const desktopDir = path.join(appDir, 'platforms/electron')
// The Mobile host (React Native app, WebView entry, bridge, stores) lives in the shared UI folder since spec 009 T048.
export const mobileDir = path.join(appDir, 'platforms/native')
export const configDir = path.join(coreDir, 'src/config')
export const hostAdaptersDir = path.join(desktopDir, 'host-adapters')

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'release', '.expo', 'android', 'ios', 'ui-assets', 'coverage'])

/** Normalised absolute path with forward slashes, for comparisons and messages. */
export const norm = (p) => path.resolve(p).replaceAll('\\', '/')
export const rel = (p) => path.relative(sourceRoot, p).replaceAll('\\', '/')
export const isInside = (file, dir) => {
  const r = path.relative(dir, file)
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r))
}

/** Every code file under `dir`, skipping build output and dependencies. `.d.ts` files are included. */
export function listCodeFiles(dir, { skip = SKIPPED_DIRS } = {}) {
  const out = []
  if (!existsSync(dir)) return out
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name) && !entry.name.startsWith('.')) walk(path.join(d, entry.name))
      } else if (CODE_EXTENSIONS.includes(path.extname(entry.name))) {
        out.push(path.join(d, entry.name))
      }
    }
  }
  walk(dir)
  return out.sort()
}

const scriptKind = (file) => {
  const ext = path.extname(file)
  if (ext === '.tsx') return ts.ScriptKind.TSX
  if (ext === '.jsx') return ts.ScriptKind.JSX
  if (['.js', '.mjs', '.cjs'].includes(ext)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/**
 * Module references of one file: static imports and re-exports, `import()`, `require()`, `import x = require()`,
 * and `import('x').T` types. `typeOnly` is true when nothing of the module exists at run time.
 */
export function scanImports(file, text = readFileSync(file, 'utf8')) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file))
  const found = []
  const add = (node, specifier, typeOnly) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    found.push({ specifier, typeOnly, line })
  }
  const literal = (node) => (node && ts.isStringLiteralLike(node) ? node.text : null)
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const spec = literal(node.moduleSpecifier)
      if (spec !== null) {
        const clause = node.importClause
        const typeOnly = Boolean(
          clause &&
            (clause.isTypeOnly ||
              (!clause.name &&
                clause.namedBindings &&
                ts.isNamedImports(clause.namedBindings) &&
                clause.namedBindings.elements.length > 0 &&
                clause.namedBindings.elements.every((e) => e.isTypeOnly))),
        )
        add(node, spec, typeOnly)
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const spec = literal(node.moduleSpecifier)
      const typeOnly =
        node.isTypeOnly ||
        Boolean(node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((e) => e.isTypeOnly))
      if (spec !== null) add(node, spec, typeOnly)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const spec = literal(node.moduleReference.expression)
      if (spec !== null) add(node, spec, node.isTypeOnly)
    } else if (ts.isCallExpression(node)) {
      const arg = literal(node.arguments[0])
      if (arg !== null) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node, arg, false)
        else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') add(node, arg, false)
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const spec = literal(node.argument.literal)
      if (spec !== null) add(node, spec, true)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

export const isRelative = (spec) => spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..'

/** Package name of a bare specifier: `@scope/name` or `name`; `node:fs` → `node:fs`. */
export function packageName(spec) {
  if (spec.startsWith('node:')) return spec
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/** Workspace aliases shared by Desktop and Mobile (`tsconfig.json` paths, `vite.config.ts` aliases). */
export const WORKSPACE_ALIASES = {
  '@app': appDir,
  '@core': path.join(coreDir, 'src'),
}

/** Target path of a relative or workspace-alias specifier, without touching node_modules; null for packages. */
export function targetPath(fromFile, spec) {
  const clean = spec.split('?')[0]
  if (isRelative(clean)) return path.resolve(path.dirname(fromFile), clean)
  for (const [alias, dir] of Object.entries(WORKSPACE_ALIASES)) {
    if (clean === alias) return alias === '@core' ? path.join(dir, 'index.ts') : dir
    if (clean.startsWith(`${alias}/`)) return path.join(dir, clean.slice(alias.length + 1))
  }
  return null
}

/** Resolves a target path to a file the way TS and Vite do for this repo (extension swap, index files). */
export function resolveFile(target) {
  if (!target) return null
  const candidates = [target]
  const ext = path.extname(target)
  if (['.js', '.mjs', '.cjs', '.jsx'].includes(ext)) {
    const base = target.slice(0, -ext.length)
    candidates.push(`${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`)
  }
  for (const e of CODE_EXTENSIONS) candidates.push(`${target}${e}`)
  for (const e of CODE_EXTENSIONS) candidates.push(path.join(target, `index${e}`))
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c
    } catch {
      /* not this one */
    }
  }
  return null
}

/** One violation, printed as `[R2] apps/x.ts:12 imports "y": message`. */
export function violation(rule, file, line, spec, message) {
  return { rule, file: rel(file), line, spec, message }
}

export function formatViolation(v) {
  return `[${v.rule}] ${v.file}:${v.line} imports "${v.spec}": ${v.message}`
}

/** Runs a check as a CLI: prints violations, exits 1 when there are any. */
export function runCli(name, violations, { notes = [] } = {}) {
  for (const note of notes) console.log(`note: ${note}`)
  if (violations.length === 0) {
    console.log(`${name}: OK`)
    return
  }
  for (const v of violations) console.error(formatViolation(v))
  console.error(`${name}: ${violations.length} violation(s)`)
  process.exitCode = 1
}

export const isMain = (metaUrl) => process.argv[1] && norm(fileURLToPath(metaUrl)) === norm(process.argv[1])

/** Exceptions listed in `exceptions.json` (T035); each names its rule, the file and the reason. */
export function loadExceptions() {
  const file = path.join(sourceRoot, 'scripts/boundaries/exceptions.json')
  if (!existsSync(file)) return []
  return JSON.parse(readFileSync(file, 'utf8')).exceptions ?? []
}
