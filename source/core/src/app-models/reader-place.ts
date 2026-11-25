/**
 * The reader's place in the book (spec 019, FR-010a / FR-018 / FR-019, research R7): the current chapter's name from
 * the book's OWN contents, and the place detail shown beside the progress slider. One rule for the phone's bottom bar
 * and for new bookmark labels on both hosts. Pure: plain numbers and strings.
 */

/** One entry of the book's contents, flattened in reading order. */
export interface ContentsEntry {
  title: string
  /**
   * A comparable reading-order position: EPUB spine index of the entry's section, PDF 0-based page, Markdown heading
   * index.
   */
  order: number
}

export type PlaceDetail =
  | { kind: 'pageInChapter'; page: number; total: number }
  | { kind: 'page'; page: number; total: number }
  | { kind: 'percent'; value: number }

export interface Place {
  /** The chapter / outline entry / heading / title; null when the book names nothing here. */
  name: string | null
  detail: PlaceDetail
}

export type PlaceFormat = 'epub' | 'pdf' | 'md' | 'txt'
export type PlaceView = 'page' | 'scroll'

/**
 * The title of the LAST entry whose `order` is at or before `currentOrder` (a part no entry names takes the nearest
 * preceding one); null with no entries or before the first one. Entries need not be sorted.
 */
export function chapterNameFor(entries: readonly ContentsEntry[], currentOrder: number): string | null {
  let best: ContentsEntry | null = null
  for (const entry of entries) {
    if (!Number.isFinite(entry.order) || entry.order > currentOrder) continue
    const title = entry.title.trim()
    if (!title) continue
    // `>=`: of several entries on the same section / page, the last listed (the deepest / latest) wins.
    if (!best || entry.order >= best.order) best = { title, order: entry.order }
  }
  return best?.title ?? null
}

export interface PlaceInputs {
  /** Chapter name from `chapterNameFor`, or the book title for TXT. */
  name: string | null
  /** 0..1 book progress. */
  progress: number
  /** EPUB: page inside the current section and the section's page count (0 while still counting). */
  sectionPage?: number
  sectionPageTotal?: number
  /** PDF: 1-based current page and page count (0 while unknown). */
  page?: number
  pageTotal?: number
}

function percentOf(progress: number): PlaceDetail {
  const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
  return { kind: 'percent', value: Math.round(clamped * 100) }
}

/** The place beside the slider, per format and view (FR-010a). Never "page 0": unknown counts fall back to percent. */
export function placeFor(format: PlaceFormat, view: PlaceView, inputs: PlaceInputs): Place {
  const name = inputs.name?.trim() ? inputs.name.trim() : null
  switch (format) {
    case 'epub': {
      const page = inputs.sectionPage ?? 0
      const total = inputs.sectionPageTotal ?? 0
      if (view === 'page' && total > 0 && page > 0) {
        return { name, detail: { kind: 'pageInChapter', page: Math.min(page, total), total } }
      }
      return { name, detail: percentOf(inputs.progress) }
    }
    case 'pdf': {
      const page = inputs.page ?? 0
      const total = inputs.pageTotal ?? 0
      if (total > 0 && page > 0) return { name, detail: { kind: 'page', page: Math.min(page, total), total } }
      return { name, detail: percentOf(inputs.progress) }
    }
    case 'md':
    case 'txt':
      return { name, detail: percentOf(inputs.progress) }
  }
}

/** A new bookmark's label: the chapter name, else the place detail formatted by the caller (FR-019). */
export function bookmarkLabelFor(place: Place, formatDetail: (detail: PlaceDetail) => string): string {
  return place.name ?? formatDetail(place.detail)
}
