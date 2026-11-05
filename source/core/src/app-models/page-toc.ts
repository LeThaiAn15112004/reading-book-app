/**
 * Active table-of-contents entry for a page-addressed document (PDF outline).
 *
 * Rule, over the TOC flattened in document order (pre-order: a parent before its children, siblings
 * in order):
 * 1. Entries without a usable destination (not a positive integer page) are ignored — they are
 *    never guessed as page 1, and their children are still considered.
 * 2. The winning page is the largest destination page `<= currentPage`.
 * 3. Among the entries on that page, `preferredId` wins when it is one of them (the entry the
 *    reader just clicked); otherwise the LAST one in document order wins — for a parent and child
 *    on the same page that is the child (the most specific section that has started), for siblings
 *    on the same page the later sibling.
 * 4. No entry (null) when the current page is invalid or every usable destination is after it.
 *
 * Entries on later pages never win just because they are close, so a sibling on page 6 is not
 * active while reading page 5. Ancestors of the active entry are left to the caller (the sidebar
 * marks them as "parent of active").
 */
export type PageTocNode<T> = { id: string; children: readonly T[] }

export function resolveActivePageTocEntry<T extends PageTocNode<T>>(
  items: readonly T[],
  currentPage: number,
  pageOf: (item: T) => number | null | undefined,
  preferredId?: string | null,
): T | null {
  if (!Number.isInteger(currentPage) || currentPage < 1) return null

  let bestPage = 0
  let best: T | null = null
  let preferred: { item: T; page: number } | null = null

  for (const item of flattenInDocumentOrder(items)) {
    const page = pageOf(item)
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > currentPage) continue
    if (page >= bestPage) {
      bestPage = page
      best = item
    }
    if (preferredId != null && item.id === preferredId) preferred = { item, page }
  }

  return preferred && preferred.page === bestPage ? preferred.item : best
}

function flattenInDocumentOrder<T extends PageTocNode<T>>(items: readonly T[]): T[] {
  const out: T[] = []
  const visit = (entries: readonly T[]) => {
    for (const item of entries) {
      out.push(item)
      visit(item.children)
    }
  }
  visit(items)
  return out
}
