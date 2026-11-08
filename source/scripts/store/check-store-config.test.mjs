// Spec 010 T011 — negative tests for check-store-config.mjs (contracts/store-build.md "Errors", data-model §1–§2).
// Run: node --test source/scripts/store/check-store-config.test.mjs  (also `npm run check:store-config -- --self-test`)
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PLACEHOLDER, checkStoreConfig, lastSubmittedVersion, readReleaseVersion } from './check-store-config.mjs'

const VALID_IDENTITY = {
  identityName: '12345Readmate.ReadmateReader',
  publisher: 'CN=1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D',
  publisherDisplayName: 'Readmate',
  applicationId: 'ReadmateReader',
  displayName: 'Readmate Reader',
  languages: ['en-US', 'vi-VN'],
  backgroundColor: 'transparent',
  minVersion: '10.0.17763.0',
  maxVersionTested: '10.0.26100.0',
  capabilities: ['runFullTrust'],
  addAutoLaunchExtension: false,
}
const VALID_EXTENSIONS =
  '<desktop:Extension Category="windows.startupTask" Executable="app\\Readmate Reader.exe"><desktop:StartupTask TaskId="ReadmateReaderStartup" Enabled="false" /></desktop:Extension>'
const EMPTY_LOG = '| Version | Date | Package SHA-256 | WACK | Smoke | Result | Notes |\n|---|---|---|---|---|---|---|\n'

function run(over = {}) {
  return checkStoreConfig({
    identity: { ...VALID_IDENTITY, ...(over.identity ?? {}) },
    version: over.version ?? '1.0.0',
    extensionsXml: 'extensionsXml' in over ? over.extensionsXml : VALID_EXTENSIONS,
    submissionsMd: over.submissionsMd ?? EMPTY_LOG,
    allowPlaceholders: over.allowPlaceholders ?? false,
  })
}
const codes = (r) => r.errors.map((e) => e.code)
const fieldsOf = (r, code) => r.errors.filter((e) => e.code === code).map((e) => e.field)

describe('check-store-config', () => {
  it('accepts a complete, valid configuration', () => {
    assert.deepEqual(run().errors, [])
  })

  describe('identity_placeholder', () => {
    for (const field of ['identityName', 'publisher', 'publisherDisplayName']) {
      it(`refuses the placeholder in ${field}`, () => {
        const r = run({ identity: { [field]: PLACEHOLDER } })
        assert.deepEqual(fieldsOf(r, 'identity_placeholder'), [field])
        assert.match(r.errors[0].message, /Partner Center → Product identity/)
      })
    }
    it('refuses YourAppID', () => {
      assert.deepEqual(fieldsOf(run({ identity: { identityName: 'YourAppID' } }), 'identity_placeholder'), ['identityName'])
    })
    it('lists all three placeholders in one run', () => {
      const r = run({ identity: { identityName: PLACEHOLDER, publisher: PLACEHOLDER, publisherDisplayName: PLACEHOLDER } })
      assert.deepEqual(fieldsOf(r, 'identity_placeholder'), ['identityName', 'publisher', 'publisherDisplayName'])
    })
    it('--allow-placeholders passes placeholders', () => {
      const r = run({
        identity: { identityName: PLACEHOLDER, publisher: PLACEHOLDER, publisherDisplayName: PLACEHOLDER },
        allowPlaceholders: true,
      })
      assert.deepEqual(r.errors, [])
    })
    it('--allow-placeholders still fails a bad shape', () => {
      const r = run({ identity: { identityName: PLACEHOLDER, applicationId: 'CON' }, allowPlaceholders: true })
      assert.deepEqual(codes(r), ['identity_shape'])
    })
  })

  describe('identity_shape', () => {
    const bad = [
      ['identityName', 'ab', 'too short'],
      ['identityName', 'a'.repeat(51), 'too long'],
      ['identityName', 'Readmate_Reader', 'underscore'],
      ['publisher', 'O=Readmate', 'no CN='],
      ['publisherDisplayName', '  ', 'blank'],
      ['applicationId', 'CON', 'reserved name'],
      ['applicationId', '1App', 'starts with a digit'],
      ['applicationId', 'Readmate-Reader', 'dash'],
      ['displayName', '', 'empty'],
      ['languages', [], 'no language'],
      ['capabilities', ['runFullTrust', 'webcam'], 'extra capability'],
      ['capabilities', [], 'missing runFullTrust'],
      ['addAutoLaunchExtension', true, 'built-in auto-launch extension'],
      ['minVersion', '10.0.17763', 'three parts'],
    ]
    for (const [field, value, why] of bad) {
      it(`refuses ${field} (${why})`, () => {
        assert.deepEqual(fieldsOf(run({ identity: { [field]: value } }), 'identity_shape'), [field])
      })
    }
    it('refuses minVersion greater than maxVersionTested', () => {
      const r = run({ identity: { minVersion: '10.0.26100.0', maxVersionTested: '10.0.17763.0' } })
      assert.deepEqual(fieldsOf(r, 'identity_shape'), ['minVersion'])
    })
  })

  describe('version_invalid', () => {
    for (const v of ['0.0.0', '1.0', '1.0.0.1', '1.70000.0', '0.9.0', 'v1.0.0', '1.0.0-beta']) {
      it(`refuses ${JSON.stringify(v)}`, () => {
        const r = run({ version: v })
        assert.deepEqual(codes(r), ['version_invalid'])
        assert.match(r.errors[0].message, /MAJOR\.MINOR\.PATCH with MAJOR ≥ 1/)
      })
    }
    it('accepts 1.0.0 and 65535.65535.65535', () => {
      assert.deepEqual(run({ version: '1.0.0' }).errors, [])
      assert.deepEqual(run({ version: '65535.65535.65535' }).errors, [])
    })
  })

  describe('version_not_increased', () => {
    const log = (...rows) => EMPTY_LOG + rows.map((r) => `| ${r.join(' | ')} |`).join('\n') + '\n'
    const submitted = log(['1.2.0', '2026-12-01', 'abc', 'PASS', 'pass', 'certified', ''])
    it('refuses the version of the last submitted package', () => {
      const r = run({ version: '1.2.0', submissionsMd: submitted })
      assert.deepEqual(codes(r), ['version_not_increased'])
      assert.match(r.errors[0].message, /not greater than the last submitted 1\.2\.0/)
    })
    it('refuses a lower version', () => {
      assert.deepEqual(codes(run({ version: '1.1.9', submissionsMd: submitted })), ['version_not_increased'])
    })
    it('accepts a higher version (numeric compare, 1.10.0 > 1.9.0)', () => {
      const r = run({ version: '1.10.0', submissionsMd: log(['1.9.0', 'd', 'h', 'PASS', 'pass', 'published', '']) })
      assert.deepEqual(r.errors, [])
    })
    it('a row without a submission Result (added by store:wack) does not block a rebuild of that version', () => {
      const md = log(['1.0.0', 'd', 'h', 'PASS', 'pass', 'certified', ''], ['1.1.0', 'd', 'h', 'FAIL', '', '', ''])
      assert.equal(lastSubmittedVersion(md), '1.0.0')
      assert.deepEqual(run({ version: '1.1.0', submissionsMd: md }).errors, [])
    })
    it('a rejected submission still counts as submitted', () => {
      assert.deepEqual(
        codes(run({ version: '1.0.0', submissionsMd: log(['1.0.0', 'd', 'h', 'PASS', 'pass', 'rejected', 'logo']) })),
        ['version_not_increased'],
      )
    })
  })

  describe('extensions_invalid', () => {
    it('refuses extensions without the ReadmateReaderStartup task', () => {
      const r = run({ extensionsXml: '<desktop:Extension Category="windows.startupTask"><desktop:StartupTask TaskId="SlackStartup" /></desktop:Extension>' })
      assert.deepEqual(codes(r), ['extensions_invalid'])
    })
    it('refuses a missing extensions file', () => {
      assert.deepEqual(codes(run({ extensionsXml: null })), ['extensions_invalid'])
    })
  })

  it('reports every error of one run together', () => {
    const r = run({
      identity: { identityName: PLACEHOLDER, applicationId: 'CON' },
      version: '0.0.0',
      extensionsXml: '',
    })
    assert.deepEqual(codes(r).sort(), ['extensions_invalid', 'identity_placeholder', 'identity_shape', 'version_invalid'])
  })

  describe('readReleaseVersion', () => {
    it('reads extraMetadata.version from electron-builder.json5 text', () => {
      const text = '{\n  // c\n  "extraMetadata": {\n    "name": "reading-book-desktop",\n    "version": "1.2.3",\n    "main": "x"\n  }\n}'
      assert.equal(readReleaseVersion(text), '1.2.3')
    })
    it('returns null without an extraMetadata version', () => {
      assert.equal(readReleaseVersion('{ "version": "9.9.9" }'), null)
    })
  })
})
