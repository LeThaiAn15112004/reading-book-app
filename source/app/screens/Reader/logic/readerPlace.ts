/**
 * The book's own contents as core `ContentsEntry[]`, per format (spec 019 FR-018, research R7), and the text of a
 * place detail. Shared by the Desktop Reader (new bookmark labels) and the phone reader (bottom bar, bookmark labels):
 * the chapter name always comes from the open book, never from the Reader's demo content.
 */
import { chapterNameFor, type ContentsEntry, type MdHeadingInfo, type PlaceDetail, type Translator } from '@core'
import type { EpubTocItem } from '../../../components/reader/renderers/epub'
import { normalizeHrefForLocation } from '../../../components/reader/renderers/epub/href'
import { pdfTocItemPage } from './hooks/useReaderNavigation'

/** The contents tree in reading order (parents before their children). */
export function flattenToc(items: readonly EpubTocItem[], out: EpubTocItem[] = []): EpubTocItem[] {
  for (const item of items) {
    out.push(item)
    if (item.children?.length) flattenToc(item.children, out)
  }
  return out
}

/** EPUB: each contents entry at the spine index of its section (`spineHrefs` index-aligned with `spineIndex`). */
export function epubContentsEntries(toc: readonly EpubTocItem[], spineHrefs: readonly string[]): ContentsEntry[] {
  const indexOf = new Map<string, number>()
  spineHrefs.forEach((href, index) => {
    const key = normalizeHrefForLocation(href)
    if (key && !indexOf.has(key)) indexOf.set(key, index)
  })
  // A spine href may be a longer path than the TOC's (`OEBPS/ch1.xhtml` vs `ch1.xhtml`): match on the path's end.
  const lookup = (href: string): number | undefined => {
    const key = normalizeHrefForLocation(href)
    if (!key) return undefined
    const exact = indexOf.get(key)
    if (exact !== undefined) return exact
    for (const [spine, index] of indexOf) {
      if (spine.endsWith(`/${key}`) || key.endsWith(`/${spine}`)) return index
    }
    return undefined
  }
  const entries: ContentsEntry[] = []
  for (const item of flattenToc(toc)) {
    const order = lookup(item.href)
    if (order !== undefined) entries.push({ title: item.label, order })
  }
  return entries
}

/** PDF: each outline entry at its 0-based destination page. */
export function pdfContentsEntries(toc: readonly EpubTocItem[]): ContentsEntry[] {
  const entries: ContentsEntry[] = []
  for (const item of flattenToc(toc)) {
    const page = pdfTocItemPage(item)
    if (page !== null) entries.push({ title: item.label, order: page - 1 })
  }
  return entries
}

/** Markdown: each heading at its index among all headings. */
export function mdContentsEntries(headings: readonly MdHeadingInfo[]): ContentsEntry[] {
  return headings.map((heading, index) => ({ title: heading.text, order: index }))
}

export interface ChapterNameInputs {
  format: string | null
  epubToc: readonly EpubTocItem[]
  epubSpineHrefs: readonly string[]
  epubSpineIndex: number | null
  pdfToc: readonly EpubTocItem[]
  /** 1-based current PDF page (0 = unknown). */
  pdfPage: number
  mdHeadings: readonly MdHeadingInfo[]
  mdActiveHeading: number | null
}

/** The current chapter / outline entry / heading of the open book, or null when the book names nothing here. */
export function currentChapterName(inputs: ChapterNameInputs): string | null {
  switch (inputs.format) {
    case 'epub':
      return inputs.epubSpineIndex === null
        ? null
        : chapterNameFor(epubContentsEntries(inputs.epubToc, inputs.epubSpineHrefs), inputs.epubSpineIndex)
    case 'pdf':
      return inputs.pdfPage > 0 ? chapterNameFor(pdfContentsEntries(inputs.pdfToc), inputs.pdfPage - 1) : null
    case 'md':
      return inputs.mdActiveHeading === null ? null : chapterNameFor(mdContentsEntries(inputs.mdHeadings), inputs.mdActiveHeading)
    default:
      return null
  }
}

/** The text of a place detail (FR-010a): "Page 4/12 in chapter", "Page 3/20", "40%". */
export function formatPlaceDetail(detail: PlaceDetail, t: Translator): string {
  switch (detail.kind) {
    case 'pageInChapter':
      return t('reader.phone.place.pageInChapter', { page: detail.page, total: detail.total })
    case 'page':
      return t('reader.phone.place.page', { page: detail.page, total: detail.total })
    case 'percent':
      return t('reader.phone.place.percent', { value: detail.value })
  }
}
