/**
 * The reading text's CSS variables from the effective reading prefs (spec 008, T098, FR-012c step 2): the global
 * defaults with the book's own overrides already applied by `useReaderBookOpen`. Moved out of `ReaderScreen.tsx`
 * unchanged, for both Readers.
 */
import type { CSSProperties } from 'react'
import { fontFamilyCss, type FontFamily } from '@reading-book/book-reader-sdk'

export interface ReadingStyleInput {
  fontSize: number
  lineHeight: number
  fontWeight: number | string
  fontFamily: FontFamily
  textAlign: string
}

export function readingStyleFor(prefs: ReadingStyleInput): CSSProperties {
  return {
    '--reader-reading-size': `${prefs.fontSize}px`,
    '--reader-reading-line-height': String(prefs.lineHeight),
    '--reader-reading-weight': String(prefs.fontWeight),
    '--reader-font-reading': fontFamilyCss(prefs.fontFamily),
    '--reader-reading-align': prefs.textAlign,
  } as CSSProperties
}
