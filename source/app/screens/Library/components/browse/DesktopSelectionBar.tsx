import type { ReactNode } from 'react'
import { useT } from '../../../../i18n'
import { CollectionAddIcon, StarIcon, TrashIcon } from '../book/LibraryIcons'

export type DesktopSelectionBarProps = {
  count: number
  allSelected: boolean
  favoriteTarget: boolean
  onDone: () => void
  onToggleAll: () => void
  onFavorite: () => void
  onAddToCollection: () => void
  onRemove: () => void
}

const btn =
  'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-lib-border bg-transparent px-3 text-[13px] font-medium hover:bg-lib-surface-hover focus-visible:outline-2 focus-visible:outline-lib-accent disabled:cursor-default disabled:opacity-45'

function Action({
  label,
  icon,
  danger = false,
  disabled,
  onClick,
}: {
  label: string
  icon: ReactNode
  danger?: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className={`${btn} ${danger ? 'text-lib-danger' : 'text-lib-text-strong'}`} disabled={disabled} onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}

/** Desktop select mode: replaces the browse toolbar (sticky). Done / Esc leaves; the actions need at least one book. */
export function DesktopSelectionBar(p: DesktopSelectionBarProps) {
  const t = useT()
  const none = p.count === 0
  return (
    <div
      role="toolbar"
      aria-label={t('library.selection.actions')}
      className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-lib-border-soft bg-lib-surface-strong px-3 py-2"
    >
      <button type="button" className={`${btn} text-lib-text-strong`} onClick={p.onDone}>
        {t('library.selection.done')}
      </button>
      <p className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-lib-text-strong" role="status" aria-live="polite">
        {t('library.selection.count', { count: p.count })}
      </p>
      <button type="button" className={`${btn} text-lib-accent`} onClick={p.onToggleAll}>
        {p.allSelected ? t('library.selection.deselectAll') : t('library.selection.selectAll')}
      </button>
      <Action
        label={p.favoriteTarget ? t('library.selection.favorite') : t('library.selection.unfavorite')}
        icon={<StarIcon filled={!p.favoriteTarget} className="size-4" />}
        disabled={none}
        onClick={p.onFavorite}
      />
      <Action
        label={t('library.menu.addToCollection')}
        icon={<CollectionAddIcon className="size-4" />}
        disabled={none}
        onClick={p.onAddToCollection}
      />
      <Action label={t('library.selection.remove')} icon={<TrashIcon className="size-4" />} danger disabled={none} onClick={p.onRemove} />
    </div>
  )
}
