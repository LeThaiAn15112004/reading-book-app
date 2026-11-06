// Negative tests for the boundary checks (spec 008 T028, re-based by spec 009 T050): each probe of architecture-audit.md §3
// and each of rules R1-R3, R5-R9, R11, R12 and FR-033 must FAIL its check, with a message naming the rule (R4 is retired).
// Fixtures are temporary files; nothing in the repo is touched. Run: `node --test scripts/boundaries/` from `source/`.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { checkAppImports } from './check-app-imports.mjs'
import { checkMobileUiGraph } from './check-mobile-ui-graph.mjs'
import { checkNoSecrets } from './check-no-secrets.mjs'
import { checkSdkImports } from './check-sdk-imports.mjs'
import { checkWorkspaceGraph } from './check-workspace-graph.mjs'
import { formatViolation, norm, scanImports, sourceRoot } from './lib/imports.mjs'

const tmpRoots = []
after(() => tmpRoots.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** A throw-away tree; `files` maps relative paths to contents. */
function tree(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rb-boundaries-'))
  tmpRoots.push(root)
  for (const [file, content] of Object.entries(files)) {
    const p = path.join(root, file)
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  return root
}

const rules = (violations) => violations.map((v) => v.rule)
const messages = (violations) => violations.map(formatViolation).join('\n')

describe('import scanner', () => {
  test('sees static, re-export, dynamic, require and type imports, and marks type-only ones', () => {
    const found = scanImports('x.ts', [
      "import a from 'a'",
      "import type { B } from 'b'",
      "import { type C } from 'c'",
      "import { type D, e } from 'd'",
      "export * from 'f'",
      "export type { G } from 'g'",
      "const h = await import('h')",
      "const i = require('i')",
      "type J = import('j').J",
    ].join('\n'))
    assert.deepEqual(found.map((f) => [f.specifier, f.typeOnly]), [
      ['a', false], ['b', true], ['c', true], ['d', false], ['f', false], ['g', true], ['h', false], ['i', false], ['j', true],
    ])
  })
})

describe('R1, R2, R3: core src (architecture-audit.md §3 probes)', () => {
  const sdkCase = (code) => {
    const root = tree({ 'src/probe.ts': code, 'src/ok.ts': "import { createStore } from 'zustand/vanilla'\nimport { x } from './inner/x'\n", 'src/inner/x.ts': 'export const x = 1\n' })
    return checkSdkImports({ srcDir: path.join(root, 'src') })
  }

  for (const pkg of ['electron', 'pdfjs-dist', 'react-native', 'react-dom', 'better-sqlite3', 'react', 'epubjs', 'node:fs', 'expo-sqlite']) {
    test(`probe "${pkg}" fails R2`, () => {
      const v = sdkCase(`import * as m from '${pkg}'\nexport default m\n`)
      assert.deepEqual(rules(v), ['R2'], messages(v))
      assert.match(formatViolation(v[0]), /\[R2\].*probe\.ts:1 imports/)
    })
  }

  test('a type-only import of a forbidden package still fails R2', () => {
    assert.deepEqual(rules(sdkCase("import type { BrowserWindow } from 'electron'\nexport type W = BrowserWindow\n")), ['R2'])
  })

  for (const spec of ['@app/screens/Library/LibraryScreen', '@app']) {
    test(`probe "${spec}" (core importing the app) fails R3`, () => {
      assert.deepEqual(rules(sdkCase(`import * as a from '${spec}'\nexport { a }\n`)), ['R3'])
    })
  }

  test('probe "../../app/platforms/electron/ipc/channels" (a path out of core src) fails R3', () => {
    assert.deepEqual(rules(sdkCase("import { AppChannels } from '../../app/platforms/electron/ipc/channels'\nexport { AppChannels }\n")), ['R3'])
  })

  test('a relative path just outside src fails R3', () => {
    assert.deepEqual(rules(sdkCase("export * from '../host-adapters/services'\n")), ['R3'])
  })

  test('zustand/vanilla and relative paths inside src pass', () => {
    assert.deepEqual(sdkCase('export const fine = 1\n'), [])
  })

  test('the real core src passes', () => {
    assert.deepEqual(checkSdkImports(), [])
  })

  // `window` and `Buffer` are globals, not imports: R1 is the core tsconfig (`lib: ES2022`, `types: []`).
  for (const [probe, code] of [['window', 'export const w = window.location\n'], ['Buffer', 'export const b = Buffer.from("x")\n']]) {
    test(`probe "${probe}" fails the core tsconfig (R1)`, () => {
      const root = tree({ 'probe.ts': code })
      writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
        extends: norm(path.join(sourceRoot, '..', 'tsconfig.core.json')),
        compilerOptions: { noEmit: true, rootDir: norm(root) },
        include: [],
        files: [norm(path.join(root, 'probe.ts'))],
      }))
      const tsc = path.join(sourceRoot, '..', 'node_modules/typescript/bin/tsc')
      const out = spawnSync(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.json')], { encoding: 'utf8' })
      assert.notEqual(out.status, 0, 'tsc should fail')
      assert.match(out.stdout, new RegExp(`Cannot find name '${probe}'`))
    })
  }
})

describe('R6, R7, R8, R11, R12: app imports', () => {
  const E = 'app/platforms/electron'
  const N = 'app/platforms/native'
  const apps = (files, exceptions = []) => {
    const root = tree(files)
    return checkAppImports({
      app: path.join(root, 'app'),
      core: path.join(root, 'core'),
      electron: path.join(root, E),
      native: path.join(root, N),
      hostAdapters: path.join(root, E, 'host-adapters'),
      exceptions,
    })
  }
  const base = {
    'core/src/db/driver.ts': 'export type SyncSqlDriver = object\nexport type AsyncSqlDriver = object\n',
    [`${E}/persistence/sql-driver.ts`]: "import type { SyncSqlDriver } from '../../../../core/src/db/driver'\nexport type D = SyncSqlDriver\n",
    [`${N}/bridge/host-sql-driver.ts`]: "import type { AsyncSqlDriver } from '../../../../core/src/db/driver'\nexport type D = AsyncSqlDriver\n",
    'app/screens/Ui.tsx': "import { api } from '../platforms/api'\nexport const Ui = api\n",
    'app/platforms/api.electron.ts': 'export const api = 1\n',
    'app/platforms/api.native.ts': 'export const api = 2\n',
    [`${E}/main.ts`]: 'export const main = 1\n',
    [`${E}/host-adapters/cloud.ts`]: 'export const cloud = 1\n',
    [`${N}/host/host.ts`]: 'export const host = 1\n',
    [`${N}/stores/store.ts`]: 'export const store = 1\n',
  }

  test('the Desktop host importing the Mobile host fails R7', () => {
    assert.deepEqual(rules(apps({ ...base, [`${E}/x.ts`]: "import { host } from '../native/host/host'\nexport { host }\n" })), ['R7'])
  })

  test('the Mobile host importing the Desktop host fails R7', () => {
    assert.deepEqual(rules(apps({ ...base, [`${N}/host/x.ts`]: "import { main } from '../../electron/main'\nexport { main }\n" })), ['R7'])
  })

  test('the WebView side importing Desktop runtime code fails R7', () => {
    assert.deepEqual(rules(apps({ ...base, [`${N}/stores/x.ts`]: "import { main } from '../../electron/main'\nexport { main }\n" })), ['R7'])
  })

  test('a .electron adapter importing a .native adapter fails R7', () => {
    assert.deepEqual(rules(apps({ ...base, 'app/platforms/storage.electron.ts': "import { api } from './api.native'\nexport { api }\n" })), ['R7'])
  })

  test('a .native adapter importing Desktop host code fails R7, but only its types pass', () => {
    assert.deepEqual(rules(apps({ ...base, 'app/platforms/x.native.ts': "import { main } from './electron/main'\nexport { main }\n" })), ['R7'])
    assert.deepEqual(apps({ ...base, 'app/platforms/x.native.ts': "import type { main } from './electron/main'\nexport type M = typeof main\n" }), [])
  })

  test('a .native adapter importing the Mobile folder passes, as does the shared UI importing a host type-only', () => {
    assert.deepEqual(apps({ ...base, 'app/platforms/x.native.ts': "import { store } from './native/stores/store'\nexport { store }\n", 'app/screens/T.ts': "import type { main } from '../platforms/electron/main'\nexport type M = typeof main\n" }), [])
  })

  for (const pkg of ['electron', 'better-sqlite3']) {
    test(`Mobile code importing "${pkg}" fails R8`, () => {
      assert.deepEqual(rules(apps({ ...base, [`${N}/stores/x.ts`]: `import * as m from '${pkg}'\nexport default m\n` })), ['R8'])
    })
  }

  for (const pkg of ['react-dom', 'react-dom/client']) {
    test(`Mobile host importing "${pkg}" fails R8, the WebView side may`, () => {
      assert.deepEqual(rules(apps({ ...base, [`${N}/host/x.ts`]: `import * as m from '${pkg}'\nexport default m\n` })), ['R8'])
      assert.deepEqual(apps({ ...base, [`${N}/stores/x.ts`]: `import * as m from '${pkg}'\nexport default m\n` }), [])
    })
  }

  test('Mobile importing host-adapters by path fails R11 (and R7, it is Desktop code)', () => {
    assert.deepEqual(rules(apps({ ...base, [`${N}/stores/x.ts`]: "import { cloud } from '../../electron/host-adapters/cloud'\nexport { cloud }\n" })), ['R7', 'R11'])
  })

  test('shared UI importing host-adapters fails R11, unless listed in exceptions.json', () => {
    const files = { ...base, 'app/hooks/useCloud.ts': "import { cloud } from '../platforms/electron/host-adapters/cloud'\nexport { cloud }\n" }
    assert.deepEqual(rules(apps(files)), ['R11'])
    // The exception is keyed by the path in the real tree (relative to source/), so a fixture file is not covered by it.
    assert.deepEqual(rules(apps(files, [{ rule: 'R11', kind: 'app-imports', importedBy: 'app/hooks/useCloud.ts' }])), ['R11'])
  })

  test('the Desktop host importing host-adapters passes', () => {
    assert.deepEqual(apps({ ...base, [`${E}/ipc/x.ts`]: "import { cloud } from '../host-adapters/cloud'\nexport { cloud }\n" }), [])
  })

  for (const spec of ['../platforms/api.electron', '../platforms/api.native', '../platforms/api.native.ts']) {
    test(`UI importing "${spec}" fails R12`, () => {
      assert.deepEqual(rules(apps({ ...base, 'app/screens/X.ts': `import { api } from '${spec}'\nexport { api }\n` })), ['R12'])
    })
  }

  test('UI importing the adapter without a suffix passes R12', () => {
    assert.deepEqual(apps(base), [])
  })

  test('a driver adapter that does not import its core port fails R6', () => {
    const v = apps({ ...base, [`${E}/persistence/sql-driver.ts`]: 'export const createSyncSqlDriver = () => ({})\n' })
    assert.deepEqual(rules(v), ['R6'], messages(v))
    assert.match(messages(v), /SyncSqlDriver/)
  })

  test('a missing driver adapter fails R6', () => {
    const { [`${N}/bridge/host-sql-driver.ts`]: _removed, ...rest } = base
    assert.deepEqual(rules(apps(rest)), ['R6'])
  })

  test('the real app passes', () => {
    assert.deepEqual(checkAppImports(), [])
  })
})

describe('R8: Mobile UI bundle graph', () => {
  const graph = (files, allowedFile) => {
    const root = tree(files)
    const desktop = path.join(root, 'app/platforms/electron')
    return checkMobileUiGraph({
      entries: [path.join(root, 'app/platforms/native/main.ts')],
      desktop,
      allowed: new Set(allowedFile ? [norm(path.join(desktop, allowedFile))] : []),
    }).violations
  }
  const entry = { 'app/platforms/native/main.ts': "import '../../main'\n" }

  test('a runtime import of Desktop host code reached through the shared UI fails R8', () => {
    const v = graph({ ...entry, 'app/main.ts': "import { send } from './platforms/electron/ipc/send'\nsend()\n", 'app/platforms/electron/ipc/send.ts': 'export function send() {}\n' })
    assert.deepEqual(rules(v), ['R8'], messages(v))
  })

  test('a dynamic import of Desktop host code fails R8', () => {
    assert.deepEqual(rules(graph({ ...entry, 'app/main.ts': "void import('./platforms/electron/ipc/send')\n", 'app/platforms/electron/ipc/send.ts': 'export {}\n' })), ['R8'])
  })

  test('the electron package in the graph fails R8', () => {
    assert.deepEqual(rules(graph({ ...entry, 'app/main.ts': "import { ipcRenderer } from 'electron'\nvoid ipcRenderer\n" })), ['R8'])
  })

  test('a type-only import of Desktop host code passes', () => {
    assert.deepEqual(graph({ ...entry, 'app/main.ts': "import type { Dto } from './platforms/electron/ipc/api-types'\nexport type X = Dto\n", 'app/platforms/electron/ipc/api-types.ts': 'export type Dto = 1\n' }), [])
  })

  test('the listed exception passes, but its own runtime import of Desktop host code fails R8', () => {
    const files = {
      ...entry,
      'app/main.ts': "import { parse } from './platforms/electron/pdf-sync/pdf-font-embed'\nparse()\n",
      'app/platforms/electron/pdf-sync/pdf-font-embed.ts': 'export function parse() {}\n',
    }
    assert.deepEqual(graph(files, 'pdf-sync/pdf-font-embed.ts'), [])
    const leaking = { ...files, 'app/platforms/electron/pdf-sync/pdf-font-embed.ts': "import { fs } from './fs-helper'\nexport function parse() { return fs }\n", 'app/platforms/electron/pdf-sync/fs-helper.ts': 'export const fs = 1\n' }
    assert.deepEqual(rules(graph(leaking, 'pdf-sync/pdf-font-embed.ts')), ['R8'])
  })

  test('the real Mobile UI graph passes, and the exception is really reached', () => {
    assert.deepEqual(checkMobileUiGraph().violations, [])
    const withoutException = checkMobileUiGraph({ allowed: new Set() }).violations
    assert.ok(withoutException.some((v) => v.message.includes('pdf-font-embed')), 'without its exception the real graph must fail')
  })
})

describe('R5: area graph (app → core, never core → app)', () => {
  const area = (root, name) => ({ name, dir: path.join(root, name), manifest: { name } })

  test('core importing app while app imports core fails R5', () => {
    const root = tree({ 'core/src/x.ts': "import { a } from '../../app/a'\nexport { a }\n", 'app/a.ts': "import { x } from '../core/src/x'\nexport const a = x\n" })
    const { violations } = checkWorkspaceGraph({ packages: [area(root, 'app'), area(root, 'core')] })
    assert.deepEqual(rules(violations), ['R5'])
    assert.match(violations[0].spec, /->/)
  })

  test('a manifest-only cycle fails R5', () => {
    const root = tree({ 'a/index.ts': 'export {}\n', 'b/index.ts': 'export {}\n' })
    const pkg = (name, deps) => ({ name, dir: path.join(root, name), manifest: { name, dependencies: deps } })
    assert.deepEqual(rules(checkWorkspaceGraph({ packages: [pkg('a', { b: '*' }), pkg('b', { a: '*' })] }).violations), ['R5'])
  })

  test('app importing core alone passes', () => {
    const root = tree({ 'core/src/x.ts': 'export const x = 1\n', 'app/a.ts': "import { x } from '../core/src/x'\nexport const a = x\n" })
    assert.deepEqual(checkWorkspaceGraph({ packages: [area(root, 'app'), area(root, 'core')] }).violations, [])
  })

  test('the real areas pass', () => {
    assert.deepEqual(checkWorkspaceGraph().violations, [])
  })
})

describe('R9, R12: ESLint rules', () => {
  const repoRoot = path.resolve(sourceRoot, '..')
  const require = createRequire(path.join(repoRoot, 'package.json'))
  const { ESLint } = require('eslint')
  const eslint = new ESLint({ cwd: repoRoot })
  const lint = async (file, code) => (await eslint.lintText(code, { filePath: path.join(sourceRoot, file) }))[0].messages

  test('R9: window.api outside the api adapter fails', async () => {
    const msgs = await lint('app/screens/__probe.ts', 'export const a = window.api\n')
    assert.ok(msgs.some((m) => m.ruleId === 'no-restricted-syntax' && /R9/.test(m.message)), JSON.stringify(msgs))
  })

  test("R9: window['api'] outside the api adapter fails", async () => {
    const msgs = await lint('app/screens/__probe.ts', "export const a = window['api']\n")
    assert.ok(msgs.some((m) => /R9/.test(m.message)))
  })

  test('R9: window.api in the api adapter passes', async () => {
    const msgs = await lint('app/platforms/api.electron.ts', 'export const a = window.api\n')
    assert.ok(!msgs.some((m) => /R9/.test(m.message)))
  })

  test('R12: importing an adapter with its suffix outside platforms fails, inside platforms passes', async () => {
    const bad = await lint('app/screens/__probe.ts', "import { api } from '../platforms/api.native'\nexport { api }\n")
    assert.ok(bad.some((m) => m.ruleId === 'no-restricted-imports' && /R12/.test(m.message)), JSON.stringify(bad))
    const ok = await lint('app/platforms/__probe.ts', "import { api } from './api.native'\nexport { api }\n")
    assert.ok(!ok.some((m) => /R12/.test(m.message)))
  })
})

describe('FR-033: no secret file in a bundle', () => {
  const secret = 'TEST-ONLY-NOT-A-REAL-SECRET-0123'
  const setup = (outputFiles) => {
    const root = tree({ 'config/cloud-oauth-secrets.json': JSON.stringify({ dropbox: { appKey: 'key', appSecret: secret } }), ...outputFiles })
    return checkNoSecrets({ secretsDir: path.join(root, 'config'), outputs: [path.join(root, 'out')] }).problems
  }

  test('a secret value inside a bundle fails', () => {
    const problems = setup({ 'out/assets/main.js': `const s = "${secret}"` })
    assert.equal(problems.length, 1)
    assert.match(problems[0], /a secret value of cloud-oauth-secrets\.json/)
    assert.ok(!problems[0].includes(secret), 'the value is never printed')
  })

  test('a secret file copied into a bundle fails', () => {
    assert.ok(setup({ 'out/client_secret_123.apps.googleusercontent.com.json': '{}' }).some((p) => /a secret file is in the bundle output/.test(p)))
  })

  test('a clean bundle passes', () => {
    assert.deepEqual(setup({ 'out/assets/main.js': 'const s = "nothing here"' }), [])
  })
})
