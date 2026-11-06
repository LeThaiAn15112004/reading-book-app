// Negative tests for the boundary checks (spec 008, T028): each probe of architecture-audit.md §3 and each of rules
// R3, R5, R7, R8, R9, R11 and FR-033 must FAIL its check, with a message naming the rule. Fixtures are temporary
// files; nothing in the repo is touched. Run: `node --test scripts/boundaries/` from `source/`.
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
import { desktopDir, formatViolation, norm, scanImports, sdkDir, sourceRoot } from './lib/imports.mjs'

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

describe('R1, R2, R3: SDK src (architecture-audit.md §3 probes)', () => {
  const sdkCase = (code) => {
    const root = tree({ 'src/probe.ts': code, 'src/ok.ts': "import { createStore } from 'zustand/vanilla'\nimport { x } from './inner/x'\n", 'src/inner/x.ts': 'export const x = 1\n' })
    return checkSdkImports({ srcDir: path.join(root, 'src') })
  }

  for (const pkg of ['electron', 'pdfjs-dist', 'react-native', 'react-dom', 'better-sqlite3', 'react', 'epubjs', 'node:fs']) {
    test(`probe "${pkg}" fails R2`, () => {
      const v = sdkCase(`import * as m from '${pkg}'\nexport default m\n`)
      assert.deepEqual(rules(v), ['R2'], messages(v))
      assert.match(formatViolation(v[0]), /\[R2\].*probe\.ts:1 imports/)
    })
  }

  test('a type-only import of a forbidden package still fails R2', () => {
    assert.deepEqual(rules(sdkCase("import type { BrowserWindow } from 'electron'\nexport type W = BrowserWindow\n")), ['R2'])
  })

  test('probe "@reading-book/config" fails R3', () => {
    assert.deepEqual(rules(sdkCase("import { features } from '@reading-book/config'\nexport { features }\n")), ['R3'])
  })

  test('probe "../../reading-book-desktop/electron/ipc/channels" fails R3', () => {
    assert.deepEqual(rules(sdkCase("import { AppChannels } from '../../reading-book-desktop/electron/ipc/channels'\nexport { AppChannels }\n")), ['R3'])
  })

  test('a relative path just outside src (host-adapters) fails R3', () => {
    assert.deepEqual(rules(sdkCase("export * from '../host-adapters/services'\n")), ['R3'])
  })

  test('zustand/vanilla and relative paths inside src pass', () => {
    assert.deepEqual(sdkCase('export const fine = 1\n'), [])
  })

  test('the real SDK src passes', () => {
    assert.deepEqual(checkSdkImports(), [])
  })

  // `window` and `Buffer` are globals, not imports: R1 is the SDK tsconfig (`lib: ES2022`, `types: []`).
  for (const [probe, code] of [['window', 'export const w = window.location\n'], ['Buffer', 'export const b = Buffer.from("x")\n']]) {
    test(`probe "${probe}" fails the SDK tsconfig (R1)`, () => {
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

describe('R7, R8, R11: app imports', () => {
  const apps = (files) => {
    const root = tree(files)
    return checkAppImports({
      desktop: path.join(root, 'reading-book-desktop'),
      mobile: path.join(root, 'reading-book-mobile'),
      sdk: path.join(root, 'book-reader-sdk'),
      hostAdaptersRoot: path.join(root, 'book-reader-sdk/host-adapters'),
    })
  }
  const base = {
    'reading-book-desktop/src/ui.tsx': 'export const Ui = 1\n',
    'reading-book-desktop/electron/main.ts': 'export const main = 1\n',
    'reading-book-mobile/src/host.ts': 'export const host = 1\n',
    'book-reader-sdk/host-adapters/cloud.ts': 'export const cloud = 1\n',
  }

  test('Desktop importing Mobile fails R7', () => {
    assert.deepEqual(rules(apps({ ...base, 'reading-book-desktop/src/x.ts': "import { host } from '../../reading-book-mobile/src/host'\nexport { host }\n" })), ['R7'])
  })

  test('Mobile host importing Desktop fails R7', () => {
    assert.deepEqual(rules(apps({ ...base, 'reading-book-mobile/src/x.ts': "import { Ui } from '../../reading-book-desktop/src/ui'\nexport { Ui }\n" })), ['R7'])
  })

  test("Mobile web/ importing Desktop's electron/ (not src/) fails R7", () => {
    assert.deepEqual(rules(apps({ ...base, 'reading-book-mobile/web/src/x.ts': "import { main } from '../../../reading-book-desktop/electron/main'\nexport { main }\n" })), ['R7'])
  })

  test("Mobile web/ importing Desktop's src/ passes", () => {
    assert.deepEqual(apps({ ...base, 'reading-book-mobile/web/src/x.ts': "import { Ui } from '../../../reading-book-desktop/src/ui'\nexport { Ui }\n" }), [])
  })

  for (const pkg of ['electron', 'react-dom', 'react-dom/client']) {
    test(`Mobile host importing "${pkg}" fails R8`, () => {
      assert.deepEqual(rules(apps({ ...base, 'reading-book-mobile/src/x.ts': `import * as m from '${pkg}'\nexport default m\n` })), ['R8'])
    })
  }

  test('Mobile importing host-adapters by path fails R11', () => {
    assert.deepEqual(rules(apps({ ...base, 'reading-book-mobile/src/x.ts': "import { cloud } from '../../book-reader-sdk/host-adapters/cloud'\nexport { cloud }\n" })), ['R11'])
  })

  test('Mobile web importing host-adapters through the SDK alias fails R11', () => {
    assert.deepEqual(rules(apps({ ...base, 'reading-book-mobile/web/src/x.ts': "import { cloud } from '@reading-book/book-reader-sdk/host-adapters/cloud'\nexport { cloud }\n" })), ['R11'])
  })

  test('the real apps pass', () => {
    assert.deepEqual(checkAppImports(), [])
  })
})

describe('R8: Mobile UI bundle graph', () => {
  const graph = (files, allowedFile) => {
    const root = tree(files)
    const desktop = path.join(root, 'reading-book-desktop')
    return checkMobileUiGraph({
      entries: [path.join(root, 'reading-book-mobile/web/src/main.ts')],
      desktop,
      allowed: new Set(allowedFile ? [norm(path.join(desktop, allowedFile))] : []),
    }).violations
  }
  const entry = { 'reading-book-mobile/web/src/main.ts': "import '../../../reading-book-desktop/src/main'\n" }

  test('a runtime import of electron/ reached through Desktop src fails R8', () => {
    const v = graph({ ...entry, 'reading-book-desktop/src/main.ts': "import { send } from '../electron/ipc/send'\nsend()\n", 'reading-book-desktop/electron/ipc/send.ts': 'export function send() {}\n' })
    assert.deepEqual(rules(v), ['R8'], messages(v))
  })

  test('a dynamic import of electron/ fails R8', () => {
    assert.deepEqual(rules(graph({ ...entry, 'reading-book-desktop/src/main.ts': "void import('../electron/ipc/send')\n", 'reading-book-desktop/electron/ipc/send.ts': 'export {}\n' })), ['R8'])
  })

  test('the electron package in the graph fails R8', () => {
    assert.deepEqual(rules(graph({ ...entry, 'reading-book-desktop/src/main.ts': "import { ipcRenderer } from 'electron'\nvoid ipcRenderer\n" })), ['R8'])
  })

  test('a type-only import of electron/ passes', () => {
    assert.deepEqual(graph({ ...entry, 'reading-book-desktop/src/main.ts': "import type { Dto } from '../electron/ipc/api-types'\nexport type X = Dto\n", 'reading-book-desktop/electron/ipc/api-types.ts': 'export type Dto = 1\n' }), [])
  })

  test('the listed exception passes, but its own runtime import of electron/ fails R8', () => {
    const files = {
      ...entry,
      'reading-book-desktop/src/main.ts': "import { parse } from '../electron/pdf-sync/pdf-font-embed'\nparse()\n",
      'reading-book-desktop/electron/pdf-sync/pdf-font-embed.ts': 'export function parse() {}\n',
    }
    assert.deepEqual(graph(files, 'electron/pdf-sync/pdf-font-embed.ts'), [])
    const leaking = { ...files, 'reading-book-desktop/electron/pdf-sync/pdf-font-embed.ts': "import { fs } from './fs-helper'\nexport function parse() { return fs }\n", 'reading-book-desktop/electron/pdf-sync/fs-helper.ts': 'export const fs = 1\n' }
    assert.deepEqual(rules(graph(leaking, 'electron/pdf-sync/pdf-font-embed.ts')), ['R8'])
  })

  test('the real Mobile UI graph passes, and the exception is really reached', () => {
    assert.deepEqual(checkMobileUiGraph().violations, [])
    const withoutException = checkMobileUiGraph({ allowed: new Set() }).violations
    assert.ok(withoutException.some((v) => v.message.includes('pdf-font-embed')), 'without its exception the real graph must fail')
  })
})

describe('R5: workspace graph', () => {
  const pkg = (root, name, dir, deps = {}) => ({ name, dir: path.join(root, dir), manifest: { name, dependencies: deps } })

  test('an import cycle (SDK → config while config → SDK) fails R5', () => {
    const root = tree({ 'sdk/src/x.ts': "import { a } from '../../config/a'\nexport { a }\n", 'config/a.ts': 'export const a = 1\n' })
    const { violations } = checkWorkspaceGraph({ packages: [pkg(root, 'config', 'config', { sdk: '*' }), pkg(root, 'sdk', 'sdk')] })
    assert.deepEqual(rules(violations), ['R5'])
    assert.match(violations[0].spec, /->/)
  })

  test('a manifest-only cycle fails R5', () => {
    const root = tree({ 'a/index.ts': 'export {}\n', 'b/index.ts': 'export {}\n' })
    assert.deepEqual(rules(checkWorkspaceGraph({ packages: [pkg(root, 'a', 'a', { b: '*' }), pkg(root, 'b', 'b', { a: '*' })] }).violations), ['R5'])
  })

  test('the real workspace passes', () => {
    assert.deepEqual(checkWorkspaceGraph().violations, [])
  })
})

describe('R9: window.api only in source/app/platforms/api.electron.ts (ESLint)', () => {
  const repoRoot = path.resolve(sourceRoot, '..')
  const require = createRequire(path.join(repoRoot, 'package.json'))
  const { ESLint } = require('eslint')
  const eslint = new ESLint({ cwd: repoRoot })
  const lint = async (file, code) => (await eslint.lintText(code, { filePath: path.join(sourceRoot, file) }))[0].messages

  test('window.api outside the api adapter fails', async () => {
    const msgs = await lint('app/screens/__probe.ts', 'export const a = window.api\n')
    assert.ok(msgs.some((m) => m.ruleId === 'no-restricted-syntax' && /R9/.test(m.message)), JSON.stringify(msgs))
  })

  test("window['api'] outside the api adapter fails", async () => {
    const msgs = await lint('app/screens/__probe.ts', "export const a = window['api']\n")
    assert.ok(msgs.some((m) => /R9/.test(m.message)))
  })

  test('window.api in the api adapter passes', async () => {
    const msgs = await lint('app/platforms/api.electron.ts', 'export const a = window.api\n')
    assert.ok(!msgs.some((m) => /R9/.test(m.message)))
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
