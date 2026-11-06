/**
 * Spine + table-of-contents helpers: section linking, cover detection, TOC normalisation and the
 * footer nav state derived from spine position.
 */
import type { Book } from 'epubjs'
import type { CumulativePageMetrics } from '../progress/reader-position'
import type { EpubNavState, EpubTocItem } from './types'

export function spineLengthOf(book: Book): number {
  const spine = book.spine as { length?: number }
  return typeof spine.length === 'number' ? spine.length : 0
}

export type SpineSectionLike = {
  href?: string
  url?: string
  idref?: string
  properties?: string | string[]
  linear?: string | boolean
  next?: () => SpineSectionLike | undefined
  prev?: () => SpineSectionLike | undefined
}

export function basenameLabel(href: string): string {
  const raw = href.split('/').pop() ?? href
  const noQuery = raw.split('?')[0] ?? raw
  const noHash = noQuery.split('#')[0] ?? noQuery
  const stem = noHash.replace(/\.(x?html?|xml)$/i, '')
  try {
    return decodeURIComponent(stem)
  } catch {
    return stem
  }
}

function propertyTokens(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean)
  return String(value).split(/\s+/).filter(Boolean)
}

function spinePropertyTokens(section: SpineSectionLike | null | undefined): string[] {
  return propertyTokens(section?.properties)
}

function manifestPropertyTokens(book: Book, idref: string | undefined): string[] {
  if (!idref) return []
  const manifest = (
    book as unknown as {
      packaging?: { manifest?: Record<string, { properties?: unknown }> }
    }
  ).packaging?.manifest
  return propertyTokens(manifest?.[idref]?.properties)
}

function sectionPath(section: SpineSectionLike | null | undefined): string {
  return `${section?.href ?? ''} ${section?.idref ?? ''}`.toLowerCase()
}

export function isCoverSection(
  section: SpineSectionLike | null | undefined,
  book?: Book,
): boolean {
  const tokens = [
    ...spinePropertyTokens(section),
    ...(book ? manifestPropertyTokens(book, section?.idref) : []),
  ]
  if (
    tokens.some(
      (t) => t === 'cover-image' || t === 'cover' || t.startsWith('cover'),
    )
  ) {
    return true
  }
  return /\bcover\b/.test(sectionPath(section))
}

/**
 * epub.js leaves next()/prev() empty for `linear="no"` spine items.
 * Linking next/prev across all spine items ensures next/prev navigation smoothly
 * transitions across all sections (including cover, TOC, nav, and linear="no" items).
 */
export function linkSpineSections(book: Book): void {
  const length = spineLengthOf(book)
  for (let i = 0; i < length; i += 1) {
    const section = book.spine.get(i) as SpineSectionLike | undefined
    if (!section) continue
    const prevIndex = i - 1
    const nextIndex = i + 1
    section.prev = () =>
      prevIndex >= 0
        ? (book.spine.get(prevIndex) as SpineSectionLike | undefined)
        : undefined
    section.next = () =>
      nextIndex < length
        ? (book.spine.get(nextIndex) as SpineSectionLike | undefined)
        : undefined
  }
}

export function normalizeTocItems(items: unknown, level = 0): EpubTocItem[] {
  if (!Array.isArray(items)) return []

  return items
    .map((item, index) => {
      const raw = item as {
        id?: unknown
        label?: unknown
        href?: unknown
        subitems?: unknown
        children?: unknown
      }
      const href = typeof raw.href === 'string' ? raw.href : ''
      const label =
        typeof raw.label === 'string' && raw.label.trim()
          ? raw.label.trim()
          : href
            ? basenameLabel(href)
            : `Section ${index + 1}`
      const id =
        typeof raw.id === 'string' && raw.id.trim()
          ? raw.id
          : `${level}-${index}-${href || label}`
      const children = normalizeTocItems(raw.subitems ?? raw.children, level + 1)
      return {
        id,
        label,
        href,
        level,
        children,
      }
    })
    .filter((item) => item.href || item.children.length > 0)
}

function normalizeHrefForLocation(href: string): string {
  return href
    .split('#')[0]
    .split('?')[0]
    .replace(/^\.\//, '')
    .replace(/\\/g, '/')
}

/** Human-readable TOC title for a spine href, including nested TOC entries. */
export function resolveTocLocationLabel(
  href: string,
  items: EpubTocItem[],
): string | undefined {
  const target = normalizeHrefForLocation(href)
  if (!target) return undefined
  let match: EpubTocItem | undefined
  const visit = (entries: EpubTocItem[]) => {
    entries.forEach((entry) => {
      if (normalizeHrefForLocation(entry.href) === target) match = entry
      visit(entry.children)
    })
  }
  visit(items)
  return match?.label
}

/** Coarse 0..1 book position from spine order, used for scroll mode or unpaginated state. */
function spinePositionFraction(
  spineIndex: number,
  spineLength: number,
  sectionPage: number,
  sectionPageTotal: number,
): number {
  if (spineLength <= 0) return 0
  const withinSection =
    sectionPageTotal > 1 ? (sectionPage - 1) / sectionPageTotal : 0
  return Math.min(1, Math.max(0, (spineIndex + withinSection) / spineLength))
}

export function buildEpubNavState(
  book: Book,
  spineIndex: number,
  toc: EpubTocItem[] = [],
  displayed?: { page: number; total: number },
  cfi?: string,
  pagination?: CumulativePageMetrics | {
    pageCurrent: number
    pageTotal: number
    progress: number
    percentage?: number
    pageCountReady?: boolean
  },
): EpubNavState {
  const spineLength = spineLengthOf(book)
  const clamped =
    spineLength <= 0
      ? 0
      : Math.min(Math.max(spineIndex, 0), spineLength - 1)
  const section = book.spine.get(clamped)
  const href = section?.href ?? ''
  const label =
    resolveTocLocationLabel(href, toc) ||
    (href ? basenameLabel(href) : '') ||
    'Section'
  const sectionPage = displayed?.page ?? 1
  const sectionPageTotal = displayed?.total ?? 1
  const pageCountReady = pagination?.pageCountReady ?? true
  const pageCurrent = pagination?.pageCurrent ?? sectionPage
  const pageTotal = pagination?.pageTotal ?? sectionPageTotal
  // Always spine/CFI-derived — never the whole-book CSS-column page estimate,
  // which drifts with font-size/line-height/margins (unlike spine order).
  const percentage = spinePositionFraction(
    clamped,
    spineLength,
    sectionPage,
    sectionPageTotal,
  )
  return {
    spineIndex: clamped,
    spineLength,
    sectionPage,
    sectionPageTotal,
    pageCurrent,
    pageTotal,
    pageCountReady,
    href,
    label,
    progress: percentage,
    percentage,
    cfi: cfi || undefined,
  }
}

/**
 * Scan section text lengths in the background to seed initial page estimates.
 */
export async function scanSpineCharCounts(
  book: Book,
  signal?: AbortSignal,
): Promise<number[]> {
  const len = spineLengthOf(book)
  const charCounts: number[] = new Array(len).fill(0)
  const archive = (
    book as unknown as {
      archive?: { getText?: (href: string) => Promise<string> }
    }
  ).archive

  for (let i = 0; i < len; i += 1) {
    if (signal?.aborted) break
    const section = (book.spine.get(i) as unknown) as
      | {
          href?: string
          load?: (request?: unknown) => Promise<unknown>
        }
      | undefined
    if (!section) continue

    try {
      if (typeof archive?.getText === 'function' && section.href) {
        const rawText = await archive.getText(section.href)
        const stripped = rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
        charCounts[i] = stripped.length
        continue
      }
      if (typeof section.load === 'function') {
        const loaded = await section.load(book.load.bind(book))
        const doc =
          (loaded as { ownerDocument?: Document } | undefined)?.ownerDocument ||
          loaded
        const text =
          (doc as Document | undefined)?.body?.textContent ||
          (loaded as { textContent?: string } | undefined)?.textContent ||
          ''
        charCounts[i] = text.trim().length
      }
    } catch {
      charCounts[i] = 1200
    }
  }
  return charCounts
}
