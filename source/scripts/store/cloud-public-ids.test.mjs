// Spec 010 KL-1 — OAuth client values embedded in the Store package (cloud-public-ids.cjs).
// Run: node --test source/scripts/store/cloud-public-ids.test.mjs  (part of `npm run check:store-config -- --self-test`)
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const { EMBEDDED_KEY, readAsarFile, resolveCloudPublicIds, verifyEmbedded } = require('./cloud-public-ids.cjs')

const KEY = 'abc123def456ghi'
const GUID = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b'
const SECRETS = { dropbox: { appKey: KEY, appSecret: 'zz9secretvalue9' }, onedrive: { clientId: GUID } }
const G_ID = '123456789012-abcdefghijklmnop0123456789abcdef.apps.googleusercontent.com'
const G_SECRET = 'GOCSPX-TEST-ONLY-not-a-real-secret0'
const GOOGLE = { installed: { client_id: G_ID, client_secret: G_SECRET, redirect_uris: ['http://localhost'] } }
const ALL = { dropboxAppKey: KEY, onedriveClientId: GUID, googleClientId: G_ID, googleClientSecret: G_SECRET }
const codes = (r) => r.errors.map((e) => e.code)

describe('resolveCloudPublicIds', () => {
  it('takes both public IDs from the secrets file and never the app secret', () => {
    const r = resolveCloudPublicIds({ env: {}, secrets: SECRETS, google: GOOGLE })
    assert.deepEqual(r.errors, [])
    assert.deepEqual(r.ids, ALL)
    assert.ok(!JSON.stringify(r.ids).includes('zz9secretvalue9'))
  })

  it('prefers the build environment over the file', () => {
    const other = '11111111-2222-3333-4444-555555555555'
    const r = resolveCloudPublicIds({ env: { AZURE_CLIENT_ID: other }, secrets: SECRETS, google: GOOGLE })
    assert.equal(r.ids.onedriveClientId, other)
    assert.equal(r.sources.onedriveClientId, 'env AZURE_CLIENT_ID')
    assert.equal(r.sources.dropboxAppKey, 'cloud-oauth-secrets.json')
  })

  it('reports a missing value (CI: no file, no variable) and embeds nothing', () => {
    const r = resolveCloudPublicIds({ env: {}, secrets: null, google: null })
    assert.deepEqual(codes(r), ['cloud_id_missing', 'cloud_id_missing', 'cloud_id_missing', 'cloud_id_missing'])
    assert.deepEqual(r.ids, {})
  })

  it('refuses a secret pasted in the app-key field', () => {
    const secret = 'abcdefabcdef123'
    const r = resolveCloudPublicIds({ env: {}, secrets: { dropbox: { appKey: secret, appSecret: secret }, onedrive: { clientId: GUID } }, google: GOOGLE })
    assert.deepEqual(codes(r), ['cloud_id_is_secret'])
    assert.equal(r.ids.dropboxAppKey, undefined)
    assert.equal(r.ids.onedriveClientId, GUID)
  })

  it('refuses a value equal to a *_SECRET build variable', () => {
    const r = resolveCloudPublicIds({ env: { DROPBOX_APP_KEY: KEY, DROPBOX_APP_SECRET: KEY }, secrets: SECRETS, google: GOOGLE })
    assert.deepEqual(codes(r), ['cloud_id_is_secret'])
  })

  it('refuses values that do not have the expected format', () => {
    const r = resolveCloudPublicIds({
      env: {},
      secrets: { dropbox: { appKey: 'Not A Key!' }, onedrive: { clientId: 'not-a-guid' } },
      google: { installed: { client_id: 'nope', client_secret: 'short' } },
    })
    assert.deepEqual(codes(r), ['cloud_id_invalid', 'cloud_id_invalid', 'cloud_id_invalid', 'cloud_id_invalid'])
    assert.deepEqual(r.ids, {})
  })

  it('reports an unreadable secrets file', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cloud-ids-'))
    try {
      const file = path.join(dir, 'cloud-oauth-secrets.json')
      writeFileSync(file, '{ not json')
      const r = resolveCloudPublicIds({ env: {}, secretsFile: file, google: GOOGLE })
      assert.ok(codes(r).includes('cloud_secrets_unreadable'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('resolveCloudPublicIds — Google Drive (Desktop app client, decision 2026-11-09)', () => {
  it('embeds the Desktop client ID AND its client secret, and still never the Dropbox app secret', () => {
    const r = resolveCloudPublicIds({ env: {}, secrets: SECRETS, google: GOOGLE })
    assert.equal(r.ids.googleClientId, G_ID)
    assert.equal(r.ids.googleClientSecret, G_SECRET)
    assert.ok(!JSON.stringify(r.ids).includes('zz9secretvalue9'))
  })

  it('refuses a web client: its secret is confidential', () => {
    const r = resolveCloudPublicIds({ env: {}, secrets: SECRETS, google: { web: { client_id: G_ID, client_secret: G_SECRET } } })
    assert.deepEqual(codes(r), ['google_client_not_desktop'])
    assert.equal(r.ids.googleClientId, undefined)
    assert.equal(r.ids.googleClientSecret, undefined)
  })

  it('refuses the Dropbox app secret pasted as the Google client secret', () => {
    const google = { installed: { client_id: G_ID, client_secret: 'zz9secretvalue9' } }
    const r = resolveCloudPublicIds({ env: {}, secrets: SECRETS, google })
    assert.deepEqual(codes(r), ['cloud_id_is_secret'])
    assert.equal(r.ids.googleClientSecret, undefined)
  })

  it('takes the pair from the environment only when both variables are set', () => {
    const env = { GOOGLE_CLIENT_ID: '999-zz.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'GOCSPX-envvalue-0123456789' }
    const both = resolveCloudPublicIds({ env, secrets: SECRETS, google: GOOGLE })
    assert.deepEqual(both.errors, [])
    assert.equal(both.ids.googleClientSecret, env.GOOGLE_CLIENT_SECRET)
    assert.equal(both.sources.googleClientId, 'env GOOGLE_CLIENT_ID')
    const one = resolveCloudPublicIds({ env: { GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID }, secrets: SECRETS, google: GOOGLE })
    assert.deepEqual(codes(one), ['google_pair_mixed'])
    assert.equal(one.ids.googleClientId, undefined)
  })

  it('refuses the Google secret pasted in the Dropbox app-key field', () => {
    const google = { installed: { client_id: G_ID, client_secret: 'abcdefabcdef1234' } }
    const r = resolveCloudPublicIds({ env: {}, secrets: { ...SECRETS, dropbox: { appKey: 'abcdefabcdef1234' } }, google })
    assert.deepEqual(codes(r), ['cloud_id_is_secret'])
    assert.equal(r.ids.dropboxAppKey, undefined)
  })
})

describe('verifyEmbedded', () => {
  const ids = ALL
  it('passes when the package carries exactly the resolved IDs', () => {
    assert.deepEqual(verifyEmbedded({ [EMBEDDED_KEY]: { ...ids } }, ids), [])
  })
  it('fails on a missing object, a different value or an extra key', () => {
    assert.equal(verifyEmbedded({}, ids).length, 1)
    assert.equal(verifyEmbedded({ [EMBEDDED_KEY]: { ...ids, dropboxAppKey: 'x' } }, ids).length, 1)
    assert.equal(verifyEmbedded({ [EMBEDDED_KEY]: { ...ids, appSecret: 'x' } }, ids).length, 1)
  })
})

describe('readAsarFile', () => {
  it('reads one packed file by its header offset', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cloud-ids-asar-'))
    try {
      const a = Buffer.from('{"name":"x"}')
      const b = Buffer.from('second')
      const header = Buffer.from(JSON.stringify({ files: { 'package.json': { size: a.length, offset: '0' }, dir: { files: { 'b.txt': { size: b.length, offset: String(a.length) } } } } }))
      // Pickle layout: [4][headerPickleSize] then [headerPickleSize - 4][json length] + json (padded).
      const padded = Buffer.alloc(Math.ceil(header.length / 4) * 4)
      header.copy(padded)
      const pickle = Buffer.alloc(8 + padded.length)
      pickle.writeUInt32LE(4 + padded.length, 0)
      pickle.writeUInt32LE(header.length, 4)
      padded.copy(pickle, 8)
      const prefix = Buffer.alloc(8)
      prefix.writeUInt32LE(4, 0)
      prefix.writeUInt32LE(pickle.length, 4)
      const file = path.join(dir, 'app.asar')
      writeFileSync(file, Buffer.concat([prefix, pickle, a, b]))
      assert.equal(readAsarFile(file, 'package.json').toString(), '{"name":"x"}')
      assert.equal(readAsarFile(file, 'dir/b.txt').toString(), 'second')
      assert.throws(() => readAsarFile(file, 'missing.json'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
