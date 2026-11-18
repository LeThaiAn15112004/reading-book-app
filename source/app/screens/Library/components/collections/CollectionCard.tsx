import type { CollectionSummary } from '@core'
import type { ReactNode } from 'react'
import { useT } from '../../../../i18n'
import { MoreVertIcon } from '../book/BookItemMenu'
import { menuPointFromButton, type CollectionMenuPoint } from './menuPoint'

export type CollectionCardProps = {
  collection: CollectionSummary
  /** The covers strip (`CollectionCovers variant="card"`). */
  covers: ReactNode
  menuOpen: boolean
  onOpen: (id: string) => void
  onOpenMenu: (id: string, point: CollectionMenuPoint | null) => void
}

/**
 * One Desktop collection card (spec 015 US1 / US3). The open button is an overlay sibling of the content, so the
 * always-visible ⋮ button never sits inside it (FR-004); right-click opens the same menu. The `<h2>` name is outside
 * the button for screen readers (contracts/collections-ui.md).
 */
export function CollectionCard({ collection, covers, menuOpen, onOpen, onOpenMenu }: CollectionCardProps) {
  const t = useT()
  const count = t('library.bookCount', { count: collection.bookIds.length })
  return (
    <div
      role="listitem"
      className="group relative rounded-xl border border-lib-border-soft bg-lib-surface transition-[border-color,background-color,transform] focus-within:border-lib-accent-ring hover:border-lib-accent-ring hover:bg-lib-surface-hover motion-safe:hover:-translate-y-px"
      onContextMenu={(event) => {
        event.preventDefault()
        onOpenMenu(collection.id, { x: event.clientX, y: event.clientY })
      }}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-pointer rounded-xl border-none bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent"
        aria-label={t('library.collections.openAria', { name: collection.name })}
        onClick={() => onOpen(collection.id)}
      />
      <div className="pointer-events-none relative flex flex-col gap-3.5 p-[18px]">
        {covers}
        <div className="pr-8">
          <h2
            className="m-0 mb-1 line-clamp-2 text-base font-semibold break-words text-lib-text-strong"
            title={collection.name}
          >
            {collection.name}
          </h2>
          {collection.description ? (
            <p
              className="m-0 line-clamp-2 text-[13px] leading-snug break-words text-lib-muted group-hover:text-lib-text"
              title={collection.description}
            >
              {collection.description}
            </p>
          ) : null}
          <div className="mt-2.5 text-xs font-semibold text-lib-muted group-hover:text-lib-text">{count}</div>
        </div>
      </div>
      <button
        type="button"
        className="absolute top-[118px] right-2.5 z-10 inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-lib-muted transition-colors hover:bg-lib-chip hover:text-lib-text-strong focus-visible:bg-lib-chip focus-visible:text-lib-text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={t('library.collections.moreActionsAria', { name: collection.name })}
        title={t('library.menu.moreActions')}
        onClick={(event) => {
          event.stopPropagation()
          onOpenMenu(collection.id, menuPointFromButton(event.currentTarget))
        }}
      >
        <MoreVertIcon className="size-5" />
      </button>
    </div>
  )
}
