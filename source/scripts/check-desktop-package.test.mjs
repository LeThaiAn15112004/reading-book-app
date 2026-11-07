// Negative tests of check-desktop-package (T052): each Mobile path must be refused, Desktop paths accepted.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { checkPackagedPaths, forbiddenReason, listAsar, REQUIRED } from './check-desktop-package.mjs'

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
    const { missing } = checkPackagedPaths(REQUIRED.filter((p) => !p.includes('better-sqlite3')))
    assert.deepEqual(missing, ['node_modules/better-sqlite3/package.json'])
    assert.deepEqual(checkPackagedPaths(REQUIRED).missing, [])
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
