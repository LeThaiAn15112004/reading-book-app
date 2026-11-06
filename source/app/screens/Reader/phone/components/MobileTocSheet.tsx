import type { EpubTocItem } from '../../../../components/reader/renderers/epub'
import { MobileSheet, MobileSheetRow } from './MobileSheet'

interface FlatTocItem {
  item: EpubTocItem
  depth: number
}

function flatten(items: readonly EpubTocItem[], depth = 0, out: FlatTocItem[] = []): FlatTocItem[] {
  for (const item of items) {
    out.push({ item, depth })
    if (item.children?.length) flatten(item.children, depth + 1, out)
  }
  return out
}

/**
 * Table of contents as a bottom sheet (spec 008, T103). The entries are the ones Desktop's sidebar shows (EPUB TOC,
 * PDF outline, Markdown headings) and a choice goes through the same handler the caller passes.
 */
export function MobileTocSheet({
  items,
  activeHref,
  activeId,
  onSelect,
  onClose,
}: {
  items: readonly EpubTocItem[]
  activeHref?: string
  activeId?: string | null
  onSelect: (item: EpubTocItem) => void
  onClose: () => void
}) {
  const rows = flatten(items)
  return (
    <MobileSheet title="Contents" onClose={onClose}>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-[14px] text-lib-muted">This book has no table of contents.</p>
      ) : (
        rows.map(({ item, depth }) => (
          <MobileSheetRow
            key={item.id}
            indent={Math.min(depth, 4)}
            active={(activeId != null && item.id === activeId) || (activeHref != null && item.href === activeHref)}
            onSelect={() => {
              onSelect(item)
              onClose()
            }}
          >
            {item.label || 'Untitled'}
          </MobileSheetRow>
        ))
      )}
    </MobileSheet>
  )
}
