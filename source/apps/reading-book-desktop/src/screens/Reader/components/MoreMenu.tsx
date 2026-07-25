type MoreMenuProps = {
  open: boolean
  onShare: () => void
  onFavorites: () => void
  onBookInfo: () => void
  onTrash: () => void
}

const itemClass =
  'flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg border-none bg-transparent px-3 py-3 text-left text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-slate-100'

export function MoreMenu({
  open,
  onShare,
  onFavorites,
  onBookInfo,
  onTrash,
}: MoreMenuProps) {
  if (!open) return null

  return (
    <div
      className="absolute top-[calc(100%+8px)] right-0 z-[120] flex min-w-[min(220px,calc(100vw-24px))] flex-col gap-0.5 rounded-xl border border-slate-600/45 bg-slate-900/95 p-1.5 shadow-xl backdrop-blur-md"
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      <button className={itemClass} type="button" role="menuitem" onClick={onShare}>
        Share document
      </button>
      <button
        className={itemClass}
        type="button"
        role="menuitem"
        onClick={onFavorites}
      >
        Add to Favorites
      </button>
      <button
        className={itemClass}
        type="button"
        role="menuitem"
        onClick={onBookInfo}
      >
        Book info
      </button>
      <div className="mx-1.5 my-1 h-px bg-slate-600/30" />
      <button
        className={`${itemClass} text-red-400 hover:text-red-300`}
        type="button"
        role="menuitem"
        onClick={onTrash}
      >
        Move to trash
      </button>
    </div>
  )
}
