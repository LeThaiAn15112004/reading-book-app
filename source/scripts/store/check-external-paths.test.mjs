// Spec 010 T025 — tests for check-external-paths.mjs on fixture sources.
// Run: node --test source/scripts/store/check-external-paths.test.mjs  (part of `npm run check:store-config -- --self-test`)
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findUnmappedShellCalls } from './check-external-paths.mjs'

const check = (text) => findUnmappedShellCalls([{ path: 'x.ts', text }])
const lines = (hits) => hits.map((h) => `${h.line} ${h.call}`)

describe('findUnmappedShellCalls', () => {
  it('reports an unwrapped openPath / showItemInFolder with file:line', () => {
    const src = ['const a = 1', 'await shell.openPath(file)', 'shell.showItemInFolder(checked.path)'].join('\n')
    assert.deepEqual(lines(check(src)), ['2 shell.openPath', '3 shell.showItemInFolder'])
  })
  it('accepts calls wrapped in pathForOtherApps(…)', () => {
    const src = ['await shell.openPath(pathForOtherApps(file))', 'shell.showItemInFolder(pathForOtherApps(p))'].join('\n')
    assert.deepEqual(check(src), [])
  })
  it('reports openExternal with a file: URL (pathToFileURL or literal)', () => {
    const src = ["await shell.openExternal(pathToFileURL(x).href)", "await shell.openExternal('file:///C:/x')"].join('\n')
    assert.deepEqual(lines(check(src)), ['1 shell.openExternal', '2 shell.openExternal'])
  })
  it('accepts openExternal with web / mailto / ms-settings URLs and URL variables', () => {
    const src = [
      "await shell.openExternal('https://example.com')",
      "await shell.openExternal('ms-settings:startupapps')",
      'await shell.openExternal(url)',
      'shell.openExternal(authUrl).catch(() => {})',
      'await shell.openExternal(pathToFileURL(pathForOtherApps(x)).href)',
    ].join('\n')
    assert.deepEqual(check(src), [])
  })
  it('a user-chosen path is exempt with the comment on the line before', () => {
    const src = ['// external-path: user-chosen', 'shell.showItemInFolder(savedTo)', 'shell.showItemInFolder(other)'].join('\n')
    assert.deepEqual(lines(check(src)), ['3 shell.showItemInFolder'])
  })
  it('ignores comments that mention shell calls', () => {
    const src = ['// we used to call shell.openPath(file) here', ' * Electron\'s `shell.openPath`: …', '/* shell.openPath(x) */'].join('\n')
    assert.deepEqual(check(src), [])
  })
  it('reads an argument spread over several lines', () => {
    const src = ['shell.openPath(', '  pathForOtherApps(file),', ')', 'shell.openPath(', '  file,', ')'].join('\n')
    assert.deepEqual(lines(check(src)), ['4 shell.openPath'])
  })
})
