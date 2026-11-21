import type { ReactNode } from 'react'
import { useT } from '../../../i18n'
import { CollectionAddIcon, StarIcon, TrashIcon } from '../components/book/LibraryIcons'

export type PhoneSelectionActionsProps = {
  /** true = "Favorite" (some are not favourites yet), false = "Unfavorite" (all already are). */
  favoriteTarget: boolean
  busy: boolean
  onFavorite: () => void
  onAddToCollection: () => void
  onRemove: () => void
}

function ActionButton({
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
    <button
      type="button"
      className={`flex min-h-14 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-none bg-transparent px-2 text-[12px] font-medium active:bg-lib-chip disabled:cursor-default disabled:opacity-45 ${
        danger ? 'text-lib-danger' : 'text-lib-text-strong'
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

/**
 * The bulk actions of select mode, in place of the banner slot: outside the scroll container and above the tab bar,
 * so the list ends above it. Icon + label, 56 px tall; Remove in the danger colour, last, and always confirmed.
 */
export function PhoneSelectionActions({ favoriteTarget, busy, onFavorite, onAddToCollection, onRemove }: PhoneSelectionActionsProps) {
  const t = useT()
  return (
    <div
      role="toolbar"
      aria-label={t('library.selection.actions')}
      className="flex shrink-0 items-stretch gap-1 border-t border-lib-border-soft bg-lib-surface-strong px-2 py-1"
    >
      <ActionButton
        label={favoriteTarget ? t('library.selection.favorite') : t('library.selection.unfavorite')}
        icon={<StarIcon filled={!favoriteTarget} className="size-6" />}
        disabled={busy}
        onClick={onFavorite}
      />
      <ActionButton
        label={t('library.selection.addToCollection')}
        icon={<CollectionAddIcon className="size-6" />}
        disabled={busy}
        onClick={onAddToCollection}
      />
      <ActionButton label={t('library.selection.remove')} icon={<TrashIcon className="size-6" />} danger disabled={busy} onClick={onRemove} />
    </div>
  )
}
