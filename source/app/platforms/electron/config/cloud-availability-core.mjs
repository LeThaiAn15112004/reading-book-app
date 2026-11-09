// Spec 010 KL-1 (docs/implementation_plan/msix_store_packaging.md "Known limitations") — pure, no Electron, so a
// `node --test` can load it (source/scripts/store/cloud-availability.test.mjs). cloud-oauth-config.ts feeds it.
//
// Decision 2026-11-09: Dropbox + OneDrive ship with their public client IDs (PKCE, no secret); Google Drive is not
// offered in a packaged build (its Desktop client needs a client secret, which may not be bundled, FR-033) and is shown
// as "Coming soon" until a token-exchange service exists. In development it is offered only when both its client ID
// and secret are configured.

/** Public IDs embedded by electron-builder.store.cjs (package.json `readmateCloudOAuth`); other keys are ignored. */
export function embeddedPublicIdsFrom(pkgJson) {
  const raw = pkgJson && typeof pkgJson === 'object' ? pkgJson.readmateCloudOAuth : undefined
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  for (const key of ['dropboxAppKey', 'onedriveClientId']) {
    if (typeof raw[key] === 'string' && raw[key].trim()) out[key] = raw[key].trim()
  }
  return out
}

/**
 * Which Cloud Sources the app offers → CloudProviderAvailabilityDto.
 * @param {{ isPackaged: boolean, google: { clientId?: string, clientSecret?: string } | null }} input
 */
export function cloudProviderAvailability({ isPackaged, google }) {
  const googleConfigured = Boolean(google?.clientId?.trim() && google?.clientSecret?.trim())
  return {
    google_drive: isPackaged
      ? { available: false, reason: 'coming_soon' }
      : googleConfigured
        ? { available: true }
        : { available: false, reason: 'not_configured' },
    dropbox: { available: true },
    onedrive: { available: true },
  }
}
