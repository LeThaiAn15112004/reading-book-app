import { describe, expect, it } from 'vitest'
import { APP_STORE_URL, PLAY_STORE_URL, PRIVACY_POLICY_URL, storePageUrl } from '../../src/config/app-links'

describe('app links (spec 014 FR-020)', () => {
  it('points the privacy policy at the published page', () => {
    expect(PRIVACY_POLICY_URL).toBe('https://lethaian15112004.github.io/reading-book-app-privacy-policy/')
  })

  it('picks the store page by platform', () => {
    expect(storePageUrl('android')).toBe('https://play.google.com/store/apps/details?id=com.anle.readmate')
    expect(storePageUrl('ios')).toBe('https://apps.apple.com/us/app/readmate-reader/id6789796532')
  })

  it('has no store page for desktop or unknown platforms', () => {
    for (const platform of ['win32', 'darwin', 'linux', undefined, '']) expect(storePageUrl(platform)).toBeNull()
  })

  it('only exports https links without whitespace', () => {
    for (const url of [PRIVACY_POLICY_URL, PLAY_STORE_URL, APP_STORE_URL]) {
      expect(url.startsWith('https://')).toBe(true)
      expect(/\s/.test(url)).toBe(false)
    }
  })
})
