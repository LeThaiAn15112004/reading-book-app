// Types of cloud-availability-core.mjs (the Desktop tsconfig has no allowJs).
import type { CloudProviderAvailabilityDto } from '../ipc/api-types'

export interface EmbeddedCloudPublicIds {
  dropboxAppKey?: string
  onedriveClientId?: string
}

export function embeddedPublicIdsFrom(pkgJson: unknown): EmbeddedCloudPublicIds

export function cloudProviderAvailability(input: {
  isPackaged: boolean
  google: { clientId?: string; clientSecret?: string } | null
}): CloudProviderAvailabilityDto
