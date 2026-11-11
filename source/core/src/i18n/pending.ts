import type { PendingArea } from './types.js'

/**
 * Marks a Vietnamese area as not translated yet: `export const vi = pendingArea('reason')`. Lookups in that area fall
 * back to English. Every marker must be gone before release (`tests/i18n/i18n-release-gate.test.ts`).
 */
export function pendingArea(reason: string): PendingArea {
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error('pendingArea() needs a reason')
  }
  return { __pendingArea: true, reason }
}

export function isPendingArea(value: unknown): value is PendingArea {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __pendingArea?: unknown }).__pendingArea === true
  )
}
