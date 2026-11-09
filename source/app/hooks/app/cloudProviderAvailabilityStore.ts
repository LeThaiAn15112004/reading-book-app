import { useEffect } from 'react'
import { create } from 'zustand'
import type { ExternalLibraryProvider } from '@core'
import { cloudApi } from '../../bridge'

/**
 * Spec 010 KL-1: which Cloud Sources this build offers, asked once from Main (`cloud:getProviderAvailability`).
 * Google Drive needs its Desktop-app OAuth client (embedded in the Store package, local file in development) and is
 * "Not configured" without it (e.g. the NSIS installer); Dropbox and OneDrive are offered. Until Main answers — or if it cannot (the Mobile host has no cloud group) —
 * Google Drive stays unavailable, so a sign-in that cannot work is never offered.
 */
export type CloudProviderAvailability = Record<
  ExternalLibraryProvider,
  { available: boolean; reason?: 'coming_soon' | 'not_configured' }
>

const BEFORE_ANSWER: CloudProviderAvailability = {
  google_drive: { available: false },
  dropbox: { available: true },
  onedrive: { available: true },
}

type CloudProviderAvailabilityState = {
  availability: CloudProviderAvailability
  requested: boolean
  load: () => Promise<void>
}

export const useCloudProviderAvailabilityStore = create<CloudProviderAvailabilityState>((set, get) => ({
  availability: BEFORE_ANSWER,
  requested: false,
  load: async () => {
    if (get().requested) return
    set({ requested: true })
    try {
      const answer = await cloudApi.getProviderAvailability()
      set({ availability: { ...BEFORE_ANSWER, ...answer } })
    } catch {
      // Keep BEFORE_ANSWER: Google Drive stays off; Dropbox / OneDrive behave as before.
    }
  },
}))

/** Short UI label for an unavailable provider, or null when it is offered. */
export function cloudProviderUnavailableLabel(entry: CloudProviderAvailability[ExternalLibraryProvider]): string | null {
  if (entry.available) return null
  return entry.reason === 'not_configured' ? 'Not configured' : 'Coming soon'
}

/** The availability map; asks Main the first time any component uses it. */
export function useCloudProviderAvailability(): CloudProviderAvailability {
  const availability = useCloudProviderAvailabilityStore((s) => s.availability)
  const load = useCloudProviderAvailabilityStore((s) => s.load)
  useEffect(() => {
    void load()
  }, [load])
  return availability
}
