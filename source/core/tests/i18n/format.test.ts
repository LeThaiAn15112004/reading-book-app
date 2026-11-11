import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
} from '../../src/i18n/format'

// Intl output may use narrow / no-break spaces; compare with plain spaces.
const plain = (s: string) => s.replace(/[  ]/g, ' ')

describe('formatters (spec 012 FR-010, US4)', () => {
  it('bytes: locale decimal separator, binary steps', () => {
    expect(formatBytes('en', 1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatBytes('vi', 1.5 * 1024 * 1024)).toBe('1,5 MB')
    expect(formatBytes('en', 512)).toBe('512 B')
    expect(formatBytes('en', 2048)).toBe('2 KB')
    expect(formatBytes('vi', 3.25 * 1024 ** 3)).toBe('3,3 GB')
    expect(formatBytes('en', -1)).toBe('')
    expect(formatBytes('en', Number.NaN)).toBe('')
  })

  it('numbers and percent', () => {
    expect(formatNumber('en', 12345.67, 1)).toBe('12,345.7')
    expect(formatNumber('vi', 12345.67, 1)).toBe('12.345,7')
    expect(plain(formatPercent('en', 0.42))).toBe('42%')
    expect(plain(formatPercent('vi', 0.42))).toBe('42%')
  })

  it('dates: Vietnamese day/month/year order', () => {
    const date = new Date(2026, 10, 3, 14, 5) // 3 Nov 2026, local time
    // Exact short patterns vary between ICU versions (Node vs Chromium); the ORDER is what the spec asks for.
    expect(formatDate('vi', date, 'short')).toMatch(/^0?3\/11\/(20)?26$/)
    expect(formatDate('en', date, 'short')).toMatch(/^11\/0?3\/(20)?26$/)
    expect(formatDate('vi', date, 'long')).toContain('tháng 11')
    expect(plain(formatDateTime('en', date))).toContain('Nov 3, 2026')
    expect(formatDate('en', Number.NaN)).toBe('')
  })

  it('durations: clock is language-neutral, long form follows the language', () => {
    expect(formatDuration('vi', 3725, 'clock')).toBe('1:02:05')
    expect(formatDuration('en', 125, 'clock')).toBe('2:05')
    expect(formatDuration('en', 3725, 'long')).toBe('1 h 2 min')
    expect(formatDuration('vi', 3725, 'long')).toBe('1 giờ 2 phút')
    expect(formatDuration('vi', 7200, 'long')).toBe('2 giờ')
    expect(formatDuration('en', 42, 'long')).toBe('42 s')
    expect(formatDuration('vi', 42, 'long')).toBe('42 giây')
    expect(formatDuration('en', -5, 'long')).toBe('')
  })
})
