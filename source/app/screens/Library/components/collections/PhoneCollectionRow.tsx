import type { CollectionSummary } from '@core'
import type { ReactNode } from 'react'
import { useT } from '../../../../i18n'
import { withLongPress } from '../../../../platforms/longPress'
import { MoreVertIcon } from '../book/BookItemMenu'
import type { CollectionMenuPoint } from './CollectionItemMenu'

export type PhoneCollectionRowProps = {
  collection: CollectionSummary
  /** The small stacked covers (`CollectionCovers variant="stack"`). */
  covers: ReactNode
  menuOpen: boolean
  onOpen: (id: string) => void
  onOpenMenu: (id: string, point: CollectionMenuPoint | null) => void
}

/**
 * One compact row of the phone Collections list (spec 015 FR-013a, clarification Q5): covers · name (2 lines) ·
 * description (1 line) · count, then a 44 × 44 ⋮ beside — never inside — the open area (FR-004, FR-005). A long-press
 * opens the same menu and does not also open the collection (`withLongPress` swallows the press's click).
 */
export function PhoneCollectionRow({ collection, covers, menuOpen, onOpen, onOpenMenu }: PhoneCollectionRowProps) {
  const t = useT()
  return (
    <div
      role="listitem"
      className="flex min-h-[72px] items-center gap-2 py-1"
      {...withLongPress((event) => {
        event.preventDefault()
        onOpenMenu(collection.id, null)
      })}
    >
      <button
        type="button"
        className="flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg border-none bg-transparent px-1 py-1.5 text-left font-[inherit] text-inherit active:bg-lib-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent"
        aria-label={t('library.collections.openAria', { name: collection.name })}
        onClick={() => onOpen(collection.id)}
      >
        {covers}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-[15px] leading-snug font-semibold break-words text-lib-text-strong">
            {collection.name}
          </span>
          {collection.description ? (
            <span className="truncate text-[13px] text-lib-muted">{collection.description}</span>
          ) : null}
          <span className="text-xs text-lib-muted">
            {t('library.bookCount', { count: collection.bookIds.length })}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="ml-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-lib-muted active:bg-lib-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={t('library.collections.moreActionsAria', { name: collection.name })}
        onClick={(event) => {
          event.stopPropagation()
          onOpenMenu(collection.id, null)
        }}
      >
        <MoreVertIcon className="size-5" />
      </button>
    </div>
  )
}
