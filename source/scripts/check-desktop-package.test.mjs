// Negative tests of check-desktop-package (T052): each Mobile path must be refused, Desktop paths accepted.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { checkPackagedPaths, forbiddenReason, listAsar, REQUIRED } from './check-desktop-package.mjs'
import { resolvePackaged } from './desktop-package-deps.mjs'

describe('check-desktop-package', () => {
  test('Mobile packages and host code are refused', () => {
    for (const p of [
      'node_modules/react-native/index.js',
      'node_modules/react-native-webview/package.json',
      'node_modules/expo/package.json',
      'node_modules/expo-sqlite/build/index.js',
      'node_modules/@expo/vector-icons/package.json',
      'node_modules/@react-native/assets-registry/package.json',
      'node_modules/foo/node_modules/expo-modules-core/package.json',
      'source/app/platforms/native/main.ts',
      'source/app/platforms/api.native.js',
    ]) {
      assert.ok(forbiddenReason(p), `${p} should be refused`)
    }
  })

  test('Desktop paths are accepted', () => {
    for (const p of [
      'source/app/platforms/electron/dist-electron/main.js',
      'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      'node_modules/expose-loader/index.js',
      'node_modules/expo2/index.js',
      'source/app/platforms/electron/dist/assets/native-font.woff2',
    ]) {
      assert.equal(forbiddenReason(p), null, p)
    }
  })

  test('missing required paths are reported', () => {
    const font = 'source/app/platforms/electron/dist/assets/NotoSans-Regular-AbC123.ttf'
    const { missing } = checkPackagedPaths([...REQUIRED.filter((p) => !p.includes('better-sqlite3')), font])
    assert.deepEqual(missing, ['node_modules/better-sqlite3/package.json'])
    assert.deepEqual(checkPackagedPaths([...REQUIRED, font]).missing, [])
    assert.match(checkPackagedPaths(REQUIRED).missing.join(), /Typewriter fonts/)
  })

  test('a nested runtime package missing from the package is reported (sharp → semver@7)', () => {
    const font = 'source/app/platforms/electron/dist/assets/NotoSans-Regular-AbC123.ttf'
    const nested = 'node_modules/sharp/node_modules/semver'
    const base = [...REQUIRED, font, 'node_modules/sharp/package.json', 'node_modules/sharp/dist/libvips.mjs']
    assert.deepEqual(checkPackagedPaths(base, ['node_modules/sharp', nested]).missing, [
      `${nested}/package.json (runtime dependency of Main's externals)`,
    ])
    assert.deepEqual(checkPackagedPaths([...base, `${nested}/package.json`], ['node_modules/sharp', nested]).missing, [])
  })

  test("the allowlist follows electron-builder's re-hoisted layout, not the disk layout", () => {
    // On disk npm nested global-agent under onnxruntime-node; electron-builder's collector hoists it to the top, and
    // keeps sharp's semver@7 nested. Resolution walks up the DESTINATION folders like Node does.
    const tree = [
      { name: 'better-sqlite3', dir: 'd/bs' },
      { name: '@huggingface/transformers', dir: 'd/hf' },
      { name: 'onnxruntime-node', dir: 'd/ort' },
      { name: 'global-agent', dir: 'd/ort/node_modules/global-agent' },
      { name: 'semver', dir: 'd/rn/node_modules/semver' },
      { name: 'sharp', dir: 'd/sharp', dependencies: [{ name: 'semver', dir: 'd/sharp/node_modules/semver' }] },
      { name: 'music-metadata', dir: 'd/mm' },
      { name: 'pdfjs-dist', dir: 'd/pdf' },
    ]
    const manifests = {
      'd/hf': { dependencies: { sharp: '*', 'onnxruntime-node': '*' } },
      'd/ort': { dependencies: { 'global-agent': '*', semver: '*' } },
      'd/sharp': { dependencies: { semver: '*' }, optionalDependencies: { '@img/sharp-linux-x64': '*' } },
    }
    const { folders, installed } = resolvePackaged(tree, (dir) => manifests[dir] ?? {})
    assert.ok(installed.includes('node_modules/global-agent'))
    assert.ok(!installed.some((f) => f.startsWith('node_modules/onnxruntime-node/node_modules/')))
    assert.ok(installed.includes('node_modules/semver')) // onnxruntime-node's lookup reaches the top-level copy
    assert.ok(installed.includes('node_modules/sharp/node_modules/semver'))
    assert.ok(folders.includes('node_modules/@img/sharp-linux-x64')) // other platform: listed, not required
    assert.ok(!installed.includes('node_modules/@img/sharp-linux-x64'))
    assert.throws(() => resolvePackaged(tree, (dir) => (dir === 'd/mm' ? { dependencies: { nope: '*' } } : {})), /nope/)
  })

  test('the asar index is read', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'asar-'))
    try {
      const json = Buffer.from(
        JSON.stringify({ files: { a: { files: { 'b.js': { size: 1, offset: '0' } } }, 'c.txt': { size: 1, offset: '1' } } }),
      )
      const head = Buffer.alloc(16)
      head.writeUInt32LE(4, 0)
      head.writeUInt32LE(json.length + 8, 4)
      head.writeUInt32LE(json.length + 4, 8)
      head.writeUInt32LE(json.length, 12)
      const file = path.join(dir, 'app.asar')
      writeFileSync(file, Buffer.concat([head, json, Buffer.from('xy')]))
      assert.deepEqual(listAsar(file).sort(), ['a/b.js', 'c.txt'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
