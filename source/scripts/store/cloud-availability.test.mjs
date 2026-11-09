// Spec 010 KL-1 — which Cloud Sources a build offers, and the embedded public IDs Main reads.
// Run: node --test source/scripts/store/cloud-availability.test.mjs  (part of `npm run check:store-config -- --self-test`)
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cloudProviderAvailability, embeddedPublicIdsFrom } from '../../app/platforms/electron/config/cloud-availability-core.mjs'

const GOOGLE = { clientId: 'id.apps.googleusercontent.com', clientSecret: 's' }

describe('cloudProviderAvailability', () => {
  it('packaged build: Google Drive is "coming soon" even with credentials; Dropbox and OneDrive are offered', () => {
    assert.deepEqual(cloudProviderAvailability({ isPackaged: true, google: GOOGLE }), {
      google_drive: { available: false, reason: 'coming_soon' },
      dropbox: { available: true },
      onedrive: { available: true },
    })
  })
  it('development: Google Drive needs both the client ID and the secret', () => {
    assert.deepEqual(cloudProviderAvailability({ isPackaged: false, google: GOOGLE }).google_drive, { available: true })
    for (const google of [null, { clientId: GOOGLE.clientId }, { clientId: ' ', clientSecret: 's' }]) {
      assert.deepEqual(cloudProviderAvailability({ isPackaged: false, google }).google_drive, { available: false, reason: 'not_configured' })
    }
  })
})

describe('embeddedPublicIdsFrom', () => {
  it('keeps only the two public IDs, as non-empty strings', () => {
    const pkg = { name: 'x', readmateCloudOAuth: { dropboxAppKey: ' k ', onedriveClientId: 'g', appSecret: 'no', other: 1 } }
    assert.deepEqual(embeddedPublicIdsFrom(pkg), { dropboxAppKey: 'k', onedriveClientId: 'g' })
  })
  it('returns {} for a build without them (NSIS, development) or a malformed value', () => {
    for (const pkg of [{}, null, { readmateCloudOAuth: 'x' }, { readmateCloudOAuth: { dropboxAppKey: 3, onedriveClientId: '' } }]) {
      assert.deepEqual(embeddedPublicIdsFrom(pkg), {})
    }
  })
})
