import { localeTag } from './language.js'
import { translate } from './translate.js'
import type { UiLanguage } from './types.js'

/** Dates, numbers, sizes and durations written the way the interface language writes them (spec 012 FR-010). */

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>()

function numberFormat(lang: UiLanguage, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const id = `n|${lang}|${JSON.stringify(options)}`
  let format = cache.get(id) as Intl.NumberFormat | undefined
  if (!format) {
    format = new Intl.NumberFormat(localeTag(lang), options)
    cache.set(id, format)
  }
  return format
}

function dateFormat(lang: UiLanguage, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `d|${lang}|${JSON.stringify(options)}`
  let format = cache.get(id) as Intl.DateTimeFormat | undefined
  if (!format) {
    format = new Intl.DateTimeFormat(localeTag(lang), options)
    cache.set(id, format)
  }
  return format
}

function toDate(value: Date | number): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(
  lang: UiLanguage,
  value: Date | number,
  style: 'short' | 'medium' | 'long' = 'medium',
): string {
  const date = toDate(value)
  return date ? dateFormat(lang, { dateStyle: style }).format(date) : ''
}

export function formatDateTime(lang: UiLanguage, value: Date | number): string {
  const date = toDate(value)
  return date ? dateFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : ''
}

export function formatNumber(lang: UiLanguage, value: number, maxFractionDigits = 0): string {
  if (!Number.isFinite(value)) return ''
  return numberFormat(lang, { maximumFractionDigits: maxFractionDigits }).format(value)
}

/** `ratio0to1` = 0.42 → "42%" (en) / "42%" (vi), whole percent. */
export function formatPercent(lang: UiLanguage, ratio0to1: number): string {
  if (!Number.isFinite(ratio0to1)) return ''
  return numberFormat(lang, { style: 'percent', maximumFractionDigits: 0 }).format(ratio0to1)
}

const UNIT_KEYS = [
  'common.units.bytes',
  'common.units.kilobytes',
  'common.units.megabytes',
  'common.units.gigabytes',
] as const

/** 1 536 000 → "1.5 MB" (en) / "1,5 MB" (vi). Binary steps (1 KB = 1024 B), one decimal above bytes. */
export function formatBytes(lang: UiLanguage, bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNIT_KEYS.length - 1) {
    value /= 1024
    unit += 1
  }
  const text = formatNumber(lang, value, unit === 0 ? 0 : 1)
  return translate(lang, UNIT_KEYS[unit]!, { value: text })
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * `clock`: "1:02:05" / "2:05" (language-neutral). `long`: "1 h 2 min" / "1 giờ 2 phút" (seconds shown only under a
 * minute). Negative or non-finite → ''.
 */
export function formatDuration(lang: UiLanguage, seconds: number, style: 'clock' | 'long'): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (style === 'clock') return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`
  if (h === 0 && m === 0) return translate(lang, 'common.duration.seconds', { count: s })
  const parts: string[] = []
  if (h > 0) parts.push(translate(lang, 'common.duration.hours', { count: h }))
  if (m > 0) parts.push(translate(lang, 'common.duration.minutes', { count: m }))
  return parts.join(' ')
}
