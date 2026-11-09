/**
 * The ONE comparison form of an EPUB href (spine section or TOC entry): no `#fragment`, no `?query`, no leading `./`,
 * forward slashes. Used both to label the current chapter (`resolveTocLocationLabel`) and to mark the active TOC entry
 * (`TocSidebar`), so the two can never disagree about which entry is "here".
 */
export function normalizeHrefForLocation(href: string): string {
  return href
    .split('#')[0]
    .split('?')[0]
    .replace(/^\.\//, '')
    .replace(/\\/g, '/')
}
