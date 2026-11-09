// Spec 010 KL-1 (docs/implementation_plan/msix_store_packaging.md "Known limitations") — pure, no Electron, so a
// `node --test` can load it (source/scripts/store/cloud-availability.test.mjs). cloud-oauth-config.ts feeds it.
//
// Decisions 2026-11-09: Dropbox + OneDrive ship with their public client IDs (PKCE, no secret). Google Drive ships with
// its "Desktop app" client ID AND client secret (Google does not treat an installed app's secret as confidential), so
// it is offered whenever both are configured — embedded in the Store package, or the local file / environment in
// development. A build without them (development without the file, the NSIS installer) shows it as "Not configured".

/** Keys electron-builder.store.cjs embeds (package.json `readmateCloudOAuth`); any other key is ignored. */
const EMBEDDED_KEYS = ['dropboxAppKey', 'onedriveClientId', 'googleClientId', 'googleClientSecret']

/** Values embedded by electron-builder.store.cjs (package.json `readmateCloudOAuth`), as non-empty strings. */
export function embeddedPublicIdsFrom(pkgJson) {
  const raw = pkgJson && typeof pkgJson === 'object' ? pkgJson.readmateCloudOAuth : undefined
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  for (const key of EMBEDDED_KEYS) {
    if (typeof raw[key] === 'string' && raw[key].trim()) out[key] = raw[key].trim()
  }
  return out
}

/**
 * Which Cloud Sources the app offers → CloudProviderAvailabilityDto.
 * @param {{ google: { clientId?: string, clientSecret?: string } | null }} input
 */
export function cloudProviderAvailability({ google }) {
  const googleConfigured = Boolean(google?.clientId?.trim() && google?.clientSecret?.trim())
  return {
    google_drive: googleConfigured ? { available: true } : { available: false, reason: 'not_configured' },
    dropbox: { available: true },
    onedrive: { available: true },
  }
}
