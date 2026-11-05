/**
 * Reader derivations that do not depend on React (spec 008, T097, FR-012c step 1). Moved out of `ReaderScreen.tsx`
 * unchanged, so the Desktop Reader and the Mobile Reader compute the same values from the same inputs.
 * `ReaderScreen` still decides WHEN they run (its `useMemo` dependency lists are unchanged).
 */
import {
  TextOffsetLocation,
  buildMdOutline,
  parseMdReadingLocation,
  resolveTxtReadingOffset,
  type MdHeadingInfo,
  type MdOutlineNode,
} from '@reading-book/book-reader-sdk'
import { decodeMdSource, type MdSource } from '../../../../reader/renderers/md'
import type { EpubTocItem } from '../../../../reader/renderers/epub'

/** Sidebar Contents `href` of the N-th Markdown heading (`md-heading:N`). */
export const MD_HEADING_HREF = 'md-heading:'

/** The decoded Markdown text, or null when the open book is not a ready Markdown surface. */
export function mdSourceFor(isMdSurface: boolean, bookBytes: ArrayBuffer | null | undefined): MdSource | null {
  return isMdSurface && bookBytes ? decodeMdSource(bookBytes) : null
}

/** The headings the Markdown surface reports, as Contents entries (nested by level). */
export function mdTocFromHeadings(headings: readonly MdHeadingInfo[]): EpubTocItem[] {
  const toItem = (node: MdOutlineNode): EpubTocItem => ({
    id: `md-h-${node.index}`,
    label: node.label,
    href: `${MD_HEADING_HREF}${node.index}`,
    level: node.level,
    children: node.children.map(toItem),
  })
  return buildMdOutline([...headings]).map(toItem)
}

/** Where a TXT book opens: the saved text offset clamped to the text, else the top. */
export function txtInitialOffsetFor(resumeLocation: unknown, textLength: number): number {
  return resumeLocation instanceof TextOffsetLocation ? resolveTxtReadingOffset(resumeLocation, textLength) : 0
}

/** Where a Markdown book opens: the saved text point, if there is one. */
export function mdInitialPointFor(resumeLocation: unknown) {
  return parseMdReadingLocation(resumeLocation)
}
