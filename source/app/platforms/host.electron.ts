/**
 * Platform adapter `host`, Desktop renderer (spec 009 T041; contracts/platform-adapters.md). Chosen at build time by the
 * `.electron` suffix. On Desktop nothing is hidden: every feature is available and the host is never the phone UI.
 */
export type { AppFeature } from './host-types'
import type { AppFeature } from './host-types'

export function isMobileHost(): boolean {
  return false
}

export function isFeatureAvailable(_feature: AppFeature): boolean {
  return true
}
