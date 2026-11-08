// Spec 010 T016 — tests for check-store-package.mjs on a manifest shaped like electron-builder 26.18's appx output.
// Run: node --test source/scripts/store/check-store-package.test.mjs
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { REQUIRED_FILES, checkListing, checkManifest, normaliseEntry } from './check-store-package.mjs'

const identity = {
  identityName: '12345Readmate.ReadmateReader',
  publisher: 'CN=1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D',
  minVersion: '10.0.17763.0',
}
const manifest = (over = {}) => `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" IgnorableNamespaces="uap10">
  <Identity Name="${over.name ?? identity.identityName}"
    ProcessorArchitecture="${over.arch ?? 'x64'}"
    Publisher="${over.publisher ?? identity.publisher}"
    Version="${over.version ?? '1.0.0.0'}" />
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="${over.min ?? '10.0.17763.0'}" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Capabilities>
${over.caps ?? '    <rescap:Capability Name="runFullTrust"/>'}
  </Capabilities>
  <Applications>
    <Application Id="ReadmateReader" Executable="app\\Readmate Reader.exe" EntryPoint="Windows.FullTrustApplication">
      <Extensions>
        <desktop:Extension Category="windows.startupTask" Executable="app\\Readmate Reader.exe" EntryPoint="Windows.FullTrustApplication" uap10:Parameters="--hidden-at-startup">
          <desktop:StartupTask TaskId="${over.task ?? 'ReadmateReaderStartup'}" Enabled="false" DisplayName="Readmate Reader" />
        </desktop:Extension>
${over.protocols ?? '          <uap:Extension Category="windows.protocol"><uap:Protocol Name="readmate-reader"><uap:DisplayName>x</uap:DisplayName></uap:Protocol></uap:Extension>'}
      </Extensions>
    </Application>
  </Applications>
</Package>`

const failed = (results) => results.filter((r) => !r.ok).map((r) => r.name)
const check = (over) => failed(checkManifest(manifest(over), { identity, version: '1.0.0' }))

describe('checkManifest', () => {
  it('passes the expected manifest', () => assert.deepEqual(check({}), []))
  it('fails a different identity name / publisher / version / arch', () => {
    assert.deepEqual(check({ name: 'Other' }), ['Identity Name'])
    assert.deepEqual(check({ publisher: 'CN=Other' }), ['Identity Publisher'])
    assert.deepEqual(check({ version: '1.0.0.1' }), ['Identity Version'])
    assert.deepEqual(check({ arch: 'arm64' }), ['ProcessorArchitecture x64'])
  })
  it('compares an XML-escaped publisher', () => {
    const id = { ...identity, publisher: 'CN=Readmate & Co' }
    const xml = manifest({ publisher: 'CN=Readmate &amp; Co' })
    assert.deepEqual(failed(checkManifest(xml, { identity: id, version: '1.0.0' })), [])
  })
  it('fails extra or missing capabilities', () => {
    assert.deepEqual(check({ caps: '<rescap:Capability Name="runFullTrust"/><DeviceCapability Name="webcam"/>' }), ['Capabilities = runFullTrust only'])
    assert.deepEqual(check({ caps: '' }), ['Capabilities = runFullTrust only'])
  })
  it('fails a missing or extra protocol', () => {
    assert.deepEqual(check({ protocols: '' }), ['one windows.protocol "readmate-reader"'])
    const two = '<uap:Protocol Name="readmate-reader"></uap:Protocol><uap:Protocol Name="other"></uap:Protocol>'
    assert.deepEqual(check({ protocols: two }), ['one windows.protocol "readmate-reader"'])
  })
  it('fails the electron-builder default startup task id', () => {
    assert.deepEqual(check({ task: 'SlackStartup' }), ['one windows.startupTask "ReadmateReaderStartup"'])
  })
  it('fails a different MinVersion', () => {
    assert.deepEqual(check({ min: '10.0.14316.0' }), ['MinVersion 10.0.17763.0'])
  })
})

describe('checkListing', () => {
  it('passes a listing with every required file (percent-encoded names decoded)', () => {
    const entries = [...REQUIRED_FILES, 'app/Readmate%20Reader.exe', 'assets/StoreLogo.scale-100.png']
    assert.deepEqual(failed(checkListing(entries)), [])
  })
  it('fails a missing FFmpeg or startup-task script', () => {
    const entries = REQUIRED_FILES.filter((f) => !f.includes('ffmpeg') && !f.endsWith('.ps1'))
    assert.deepEqual(failed(checkListing(entries)), [
      'contains app/resources/ffmpeg/win32-x64/ffmpeg.exe',
      'contains app/resources/store/startup-task.ps1',
    ])
  })
  it('fails OAuth secret files anywhere in the package', () => {
    const entries = [...REQUIRED_FILES, 'app/resources/config/cloud-oauth-secrets.json', 'app/x/client_secret_123.json']
    assert.deepEqual(failed(checkListing(entries)), ['no OAuth secret files'])
  })
  it('normalises entry names', () => {
    assert.equal(normaliseEntry('./app\\Readmate%20Reader.exe'), 'app/Readmate Reader.exe')
  })
})
