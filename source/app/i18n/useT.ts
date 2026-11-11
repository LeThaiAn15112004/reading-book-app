import { useMemo } from 'react'
import {
  createTranslator,
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  type MessageRef,
  type Params,
  type Translator,
  type UiLanguage,
} from '@core'
import { getUiLanguage, useUiLanguageStore } from './uiLanguageStore'

/** Current interface language; re-renders the caller when it changes. */
export function useUiLanguage(): UiLanguage {
  return useUiLanguageStore((s) => s.language)
}

/** `t` bound to the current language (React). A language change re-renders the caller — no remount. */
export function useT(): Translator {
  const language = useUiLanguage()
  return useMemo(() => createTranslator(language), [language])
}

/** `t` for non-React code (stores, helpers): the language at the moment of the call. */
export function getT(): Translator {
  return createTranslator(getUiLanguage())
}

/** Renders a stored {@link MessageRef} in the current language. */
export function translateRef(t: Translator, ref: MessageRef): string {
  return (t as (key: string, params?: Params) => string)(ref.key, ref.params)
}

export type BoundFormat = {
  date: (value: Date | number, style?: 'short' | 'medium' | 'long') => string
  dateTime: (value: Date | number) => string
  number: (value: number, maxFractionDigits?: number) => string
  percent: (ratio0to1: number) => string
  bytes: (bytes: number) => string
  duration: (seconds: number, style: 'clock' | 'long') => string
}

function bindFormat(language: UiLanguage): BoundFormat {
  return {
    date: (value, style) => formatDate(language, value, style),
    dateTime: (value) => formatDateTime(language, value),
    number: (value, digits) => formatNumber(language, value, digits),
    percent: (ratio) => formatPercent(language, ratio),
    bytes: (bytes) => formatBytes(language, bytes),
    duration: (seconds, style) => formatDuration(language, seconds, style),
  }
}

/** Formatters bound to the current language (FR-010). */
export function useFormat(): BoundFormat {
  const language = useUiLanguage()
  return useMemo(() => bindFormat(language), [language])
}

export function getFormat(): BoundFormat {
  return bindFormat(getUiLanguage())
}
