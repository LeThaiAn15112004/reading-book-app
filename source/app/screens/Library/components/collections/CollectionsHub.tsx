import { useT } from '../../../../i18n'
import type { CollectionSummary } from '@core'
import type { ReactNode } from 'react'
import { isMobileHost } from '../../../../platforms/host'
import { CollectionCard } from './CollectionCard'
import type { CollectionMenuPoint } from './CollectionItemMenu'
import { PhoneCollectionRow } from './PhoneCollectionRow'

export function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

export type CollectionsHubProps = {
  collections: CollectionSummary[]
  /** Id of the collection whose menu is open (for `aria-expanded`). */
  menuCollectionId?: string | null
  onNewCollection: () => void
  onOpenCollection: (id: string) => void
  onOpenMenu: (id: string, point: CollectionMenuPoint | null) => void
  /** Covers of one collection in the given variant. */
  renderCovers: (collection: CollectionSummary, variant: 'card' | 'stack') => ReactNode
}

/**
 * FR-14 / T1.9a — Collections hub: list + New collection. Desktop: a card grid; phone: a one-column list of compact
 * rows (spec 015 FR-013a). Edit / Delete live in one ⋮ menu per collection (FR-004).
 */
export function CollectionsHub({
  collections,
  menuCollectionId,
  onNewCollection,
  onOpenCollection,
  onOpenMenu,
  renderCovers,
}: CollectionsHubProps) {
  const t = useT()
  const phone = isMobileHost()
  const newButton =
    'inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border-none bg-lib-accent px-4 text-[13px] font-semibold text-lib-on-accent shadow-sm transition-colors hover:bg-lib-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent'
  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${phone ? 'phone-collections' : ''}`}
      role="region"
      aria-label={t('library.collections.title')}
    >
      <header
        className={`app-titlebar flex shrink-0 items-center justify-between gap-4 border-b border-lib-border-soft bg-lib-topbar backdrop-blur-sm ${
          phone ? 'min-h-16 px-4 py-2' : 'h-16 pr-7 pl-7'
        }`}
      >
        <div className="min-w-0">
          <h1 className="m-0 truncate text-[22px] leading-tight font-semibold tracking-tight text-lib-text-strong">
            {t('library.collections.title')}
          </h1>
          <p className="m-0 mt-0.5 truncate text-[13px] text-lib-muted">{t('library.collections.subtitle')}</p>
        </div>
        <button type="button" className={`${newButton} ${phone ? 'h-11' : 'h-[38px]'}`} onClick={onNewCollection}>
          <PlusIcon className="size-4" />
          <span>{t('library.collections.new')}</span>
        </button>
      </header>

      <div
        className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain ${phone ? 'px-4 py-2' : 'px-4 py-7 sm:px-7'}`}
      >
        {collections.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
            <p className="m-0 mb-2 text-base font-semibold text-lib-text-strong">
              {t('library.collections.emptyTitle')}
            </p>
            <p className="m-0 mb-6 text-sm leading-relaxed text-lib-muted">{t('library.collections.emptyBody')}</p>
            <button type="button" className={`${newButton} h-11 px-5`} onClick={onNewCollection}>
              <PlusIcon className="size-4" />
              <span>{t('library.collections.new')}</span>
            </button>
          </div>
        ) : phone ? (
          <div className="flex flex-col divide-y divide-lib-border-soft" role="list">
            {collections.map((c) => (
              <PhoneCollectionRow
                key={c.id}
                collection={c}
                covers={renderCovers(c, 'stack')}
                menuOpen={menuCollectionId === c.id}
                onOpen={onOpenCollection}
                onOpenMenu={onOpenMenu}
              />
            ))}
          </div>
        ) : (
          <div
            className="mx-auto grid w-full max-w-[1100px] grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] gap-4"
            role="list"
          >
            {collections.map((c) => (
              <CollectionCard
                key={c.id}
                collection={c}
                covers={renderCovers(c, 'card')}
                menuOpen={menuCollectionId === c.id}
                onOpen={onOpenCollection}
                onOpenMenu={onOpenMenu}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
