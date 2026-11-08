// Spec 010 T024 — the pure helpers behind pathForOtherApps (contracts/packaged-runtime.md "Paths given to other apps").
// Run: node --test source/scripts/store/external-path.test.mjs  (part of `npm run check:store-config -- --self-test`)
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mapForOtherApps, packageFamilyNameFromExecPath } from '../../app/platforms/electron/files/external-path-core.mjs'

const EXEC = String.raw`C:\Program Files\WindowsApps\anthaile.ReadMateReader_1.0.0.0_x64__dpq7cpm4v6h3j\app\Readmate Reader.exe`
const PFN = 'anthaile.ReadMateReader_dpq7cpm4v6h3j'
const USER_DATA = String.raw`C:\Users\a\AppData\Roaming\Readmate Reader Store`
const LOCAL = String.raw`C:\Users\a\AppData\Local`
const REAL = String.raw`C:\Users\a\AppData\Local\Packages\anthaile.ReadMateReader_dpq7cpm4v6h3j\LocalCache\Roaming\Readmate Reader Store`

describe('packageFamilyNameFromExecPath', () => {
  it('reads <Name>_<PublisherId> from the WindowsApps install folder', () => {
    assert.equal(packageFamilyNameFromExecPath(EXEC), PFN)
  })
  it('the task example', () => {
    assert.equal(
      packageFamilyNameFromExecPath(String.raw`C:\Program Files\WindowsApps\12345Readmate.ReadmateReader_1.0.0.0_x64__8wekyb3d8bbwe\app\Readmate Reader.exe`),
      '12345Readmate.ReadmateReader_8wekyb3d8bbwe',
    )
  })
  it('a resource-id segment and forward slashes are fine', () => {
    assert.equal(packageFamilyNameFromExecPath('D:/WindowsApps/Foo.Bar_2.3.4.0_neutral_split.scale-100_abc123/app/x.exe'), 'Foo.Bar_abc123')
  })
  it('a path outside WindowsApps → null (direct build, dev)', () => {
    assert.equal(packageFamilyNameFromExecPath(String.raw`C:\Users\a\AppData\Local\Programs\Readmate Reader\Readmate Reader.exe`), null)
    assert.equal(packageFamilyNameFromExecPath(String.raw`C:\repo\node_modules\electron\dist\electron.exe`), null)
  })
  it('a malformed folder name → null', () => {
    assert.equal(packageFamilyNameFromExecPath(String.raw`C:\Program Files\WindowsApps\NotAPackage\app\x.exe`), null)
    assert.equal(packageFamilyNameFromExecPath(String.raw`C:\Program Files\WindowsApps`), null)
    assert.equal(packageFamilyNameFromExecPath(''), null)
  })
})

describe('mapForOtherApps', () => {
  const opts = { userData: USER_DATA, localAppData: LOCAL, pfn: PFN }
  it('maps a path inside userData to the real per-package path', () => {
    assert.equal(mapForOtherApps(`${USER_DATA}\\attachment-tmp\\a1\\report.pdf`, opts), `${REAL}\\attachment-tmp\\a1\\report.pdf`)
    assert.equal(mapForOtherApps(`${USER_DATA}\\books`, opts), `${REAL}\\books`)
  })
  it('userData itself maps to the real folder', () => {
    assert.equal(mapForOtherApps(USER_DATA, opts), REAL)
  })
  it('is case-insensitive and treats / like \\', () => {
    assert.equal(
      mapForOtherApps('c:/users/A/appdata/roaming/readmate reader store/books/x/file', opts),
      `${REAL}\\books\\x\\file`,
    )
  })
  it('a sibling folder that only starts with the same name is unchanged', () => {
    const p = String.raw`C:\Users\a\AppData\Roaming\Readmate Reader Store2\x`
    assert.equal(mapForOtherApps(p, opts), p)
  })
  it("the user's own files are unchanged", () => {
    const p = String.raw`D:\Books\novel.pdf`
    assert.equal(mapForOtherApps(p, opts), p)
  })
  it('no package family name (direct build) → unchanged', () => {
    const p = `${USER_DATA}\\books\\x`
    assert.equal(mapForOtherApps(p, { ...opts, pfn: null }), p)
    assert.equal(mapForOtherApps(p, { ...opts, localAppData: undefined }), p)
  })
})
