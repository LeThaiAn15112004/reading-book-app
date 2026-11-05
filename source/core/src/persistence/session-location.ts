import { Location } from '../domain/reading/location.js'

/** Legacy shelf placeholder written by early markAsReading (G3). */
export const STARTED_LOCATION_LABEL = 'Started'

/** Fallback Library label when CFI JSON has no embedded `label`. */
export const IN_PROGRESS_LOCATION_LABEL = 'In progress'

/**
 * Pack domain Location + optional display label into one TEXT column value.
 * Extra `label` is ignored by Location.parse / *Location.fromPlain.
 */
export function packSessionLocation(location: Location, label?: string): string {
  const plain = JSON.parse(location.toString()) as Record<string, unknown>
  const trimmed = label?.trim()
  if (trimmed) {
    plain.label = trimmed
  } else {
    delete plain.label
  }
  return JSON.stringify(plain)
}

export type UnpackedSessionLocation = {
  location: Location
  label?: string
}

/**
 * Parse stored `last_read_location`. Returns undefined for empty / legacy
 * placeholders that are not Location JSON (e.g. `Started`).
 */
export function unpackSessionLocation(raw: string): UnpackedSessionLocation | undefined {
  const trimmed = raw?.trim()
  if (!trimmed || trimmed === STARTED_LOCATION_LABEL) return undefined

  try {
    const data = JSON.parse(trimmed) as { kind?: unknown; label?: unknown }
    if (typeof data.kind !== 'string' || !data.kind) return undefined
    const location = Location.parse(trimmed)
    const label =
      typeof data.label === 'string' && data.label.trim()
        ? data.label.trim()
        : undefined
    return { location, label }
  } catch {
    return undefined
  }
}

/**
 * Human-readable last-read for Library / Continue Reading (never raw CFI JSON).
 */
export function displayLabelFromStoredLocation(raw: string): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined

  if (trimmed === STARTED_LOCATION_LABEL) return STARTED_LOCATION_LABEL

  const unpacked = unpackSessionLocation(trimmed)
  if (unpacked) {
    return unpacked.label ?? IN_PROGRESS_LOCATION_LABEL
  }

  // Non-JSON legacy free text (if any) — show as-is; never return parseable CFI JSON.
  try {
    JSON.parse(trimmed)
    return undefined
  } catch {
    return trimmed
  }
}

/** True when the column holds a resume-capable Location JSON. */
export function isPersistedLocationJson(raw: string): boolean {
  return unpackSessionLocation(raw) !== undefined
}
