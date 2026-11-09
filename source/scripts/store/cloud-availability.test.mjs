// Spec 010 KL-1 — which Cloud Sources a build offers, and the embedded values Main reads.
// Run: node --test source/scripts/store/cloud-availability.test.mjs  (part of `npm run check:store-config -- --self-test`)
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cloudProviderAvailability, embeddedPublicIdsFrom } from '../../app/platforms/electron/config/cloud-availability-core.mjs'

const GOOGLE = { clientId: 'id.apps.googleusercontent.com', clientSecret: 's' }

describe('cloudProviderAvailability', () => {
  it('offers Google Drive when its client ID and secret are configured (Store package, development); Dropbox and OneDrive always', () => {
    assert.deepEqual(cloudProviderAvailability({ google: GOOGLE }), {
      google_drive: { available: true },
      dropbox: { available: true },
      onedrive: { available: true },
    })
  })
  it('Google Drive is "not configured" without both values (e.g. the NSIS installer)', () => {
    for (const google of [null, { clientId: GOOGLE.clientId }, { clientId: ' ', clientSecret: 's' }, { clientSecret: 's' }]) {
      assert.deepEqual(cloudProviderAvailability({ google }).google_drive, { available: false, reason: 'not_configured' })
    }
  })
})

describe('embeddedPublicIdsFrom', () => {
  it('keeps only the four embedded values, as non-empty strings', () => {
    const pkg = {
      name: 'x',
      readmateCloudOAuth: { dropboxAppKey: ' k ', onedriveClientId: 'g', googleClientId: 'gid', googleClientSecret: 'gs', appSecret: 'no', other: 1 },
    }
    assert.deepEqual(embeddedPublicIdsFrom(pkg), { dropboxAppKey: 'k', onedriveClientId: 'g', googleClientId: 'gid', googleClientSecret: 'gs' })
  })
  it('returns {} for a build without them (NSIS, development) or a malformed value', () => {
    for (const pkg of [{}, null, { readmateCloudOAuth: 'x' }, { readmateCloudOAuth: { dropboxAppKey: 3, onedriveClientId: '' } }]) {
      assert.deepEqual(embeddedPublicIdsFrom(pkg), {})
    }
  })
})
