import { useEffect, useRef, useState } from 'react'
import type { CollectionSummary } from '@core'
import { useT } from '../../../../i18n'
import { useBackClose } from '../../../../hooks/app/useBackClose'
import { useDialogFocus } from '../../../../hooks/app/useDialogFocus'

export type BulkCollectionChooserProps = {
  /** `sheet` = phone bottom sheet; `dialog` = Desktop centred dialog. */
  layout: 'sheet' | 'dialog'
  collections: CollectionSummary[]
  count: number
  onClose: () => void
  /** Resolves true when the books were added (the sheet then closes); false keeps it open. */
  onChoose: (collectionId: string) => Promise<boolean>
}

/**
 * Select mode → "Collection": a bottom sheet (phone) or a dialog (Desktop) listing the collections; one tap adds every selected book (one
 * transaction, books already in it are skipped). Back, Escape or the backdrop close it.
 */
export function BulkCollectionChooser({ layout, collections, count, onClose, onChoose }: BulkCollectionChooserProps) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  useBackClose(true, onClose)
  useDialogFocus(true, sheetRef)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function choose(id: string) {
    if (busy) return
    setBusy(true)
    try {
      if (await onChoose(id)) onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[300]">
      <button
        type="button"
        className="absolute inset-0 cursor-default border-none bg-black/45"
        aria-label={t('library.phone.sheet.close')}
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-collection-chooser-title"
        className={
          layout === 'sheet'
            ? 'phone-sheet absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border border-lib-border bg-lib-surface-strong px-2 pt-3 pb-[max(12px,var(--app-safe-bottom,env(safe-area-inset-bottom)))] shadow-[var(--lib-overlay-shadow)]'
            : 'absolute top-1/2 left-1/2 max-h-[70vh] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-lib-border bg-lib-surface-strong p-2 pt-4 shadow-[var(--lib-overlay-shadow)]'
        }
      >
        <h2 id="phone-collection-chooser-title" className="m-0 px-3 pb-2 text-[15px] font-semibold text-lib-text-strong">
          {t('library.selection.chooseCollection', { count })}
        </h2>
        {collections.length === 0 ? (
          <p className="m-0 px-3 pb-4 text-sm text-lib-muted">{t('library.selection.noCollections')}</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {collections.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`flex w-full cursor-pointer ${layout === 'sheet' ? 'min-h-12' : 'min-h-10'} items-center justify-between gap-4 rounded-lg border-none bg-transparent px-3 text-left text-[15px] text-lib-text-strong hover:bg-lib-surface-hover active:bg-lib-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-default disabled:opacity-45`}
                  disabled={busy}
                  onClick={() => void choose(c.id)}
                >
                  <span className="min-w-0 truncate">{c.name}</span>
                  <span className="shrink-0 text-xs text-lib-faint tabular-nums">{c.bookIds.length}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
