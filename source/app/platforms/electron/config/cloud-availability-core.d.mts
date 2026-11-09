// Types of cloud-availability-core.mjs (the Desktop tsconfig has no allowJs).
import type { CloudProviderAvailabilityDto } from '../ipc/api-types'

export interface EmbeddedCloudPublicIds {
  dropboxAppKey?: string
  onedriveClientId?: string
  googleClientId?: string
  /** Secret of Google's "Desktop app" client: public by Google's installed-app policy (KL-1). Main-only. */
  googleClientSecret?: string
}

export function embeddedPublicIdsFrom(pkgJson: unknown): EmbeddedCloudPublicIds

export function cloudProviderAvailability(input: {
  google: { clientId?: string; clientSecret?: string } | null
}): CloudProviderAvailabilityDto
