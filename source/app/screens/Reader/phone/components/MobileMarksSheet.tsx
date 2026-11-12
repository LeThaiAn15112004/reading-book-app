import { useState } from 'react'
import type { ReaderBookmark, ReaderHighlightBase } from '@core'
import { MobileSheet, MobileSheetRow } from './MobileSheet'
import { useT } from '../../../../i18n'
import type { MessageKey } from '@core'

type Tab = 'bookmarks' | 'notes'

const KIND_LABEL: Partial<Record<ReaderHighlightBase['styleKind'], MessageKey>> = {
  highlight: 'reader.sidebar.notes.types.highlight',
  underline: 'reader.sidebar.notes.types.underline',
  strikethrough: 'reader.sidebar.notes.types.strikethrough',
  squiggly: 'reader.sidebar.notes.types.squiggly',
  textbox: 'reader.sidebar.notes.types.textbox',
  replace: 'reader.sidebar.notes.types.replace',
  insert: 'reader.sidebar.notes.types.insert',
}

/**
 * Bookmarks and notes as one bottom sheet with two tabs (spec 008, T103). The lists and every action come from the
 * same stores as Desktop's sidebar (`useReaderBookmarks`, the open surface's highlights store); nothing is copied.
 */
export function MobileMarksSheet({
  initialTab,
  bookmarks,
  currentPlaceBookmarked,
  onToggleBookmark,
  onJumpBookmark,
  onDeleteBookmark,
  highlights,
  onJumpHighlight,
  onOpenHighlight,
  onClose,
}: {
  initialTab: Tab
  bookmarks: readonly ReaderBookmark[]
  currentPlaceBookmarked: boolean
  onToggleBookmark: () => void
  onJumpBookmark: (bookmark: ReaderBookmark) => void
  onDeleteBookmark: (id: string) => void
  highlights: readonly ReaderHighlightBase[]
  onJumpHighlight: (highlight: ReaderHighlightBase) => void
  /** Opens the mark's own sheet (colour, note, delete); absent when marks are read-only (TXT on Mobile). */
  onOpenHighlight?: (highlight: ReaderHighlightBase) => void
  onClose: () => void
}) {
  const t = useT()
  const [tab, setTab] = useState<Tab>(initialTab)
  const tabButton = (id: Tab, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`min-h-[44px] flex-1 rounded-lg text-[14px] font-semibold ${tab === id ? 'bg-lib-surface text-lib-text-strong' : 'text-lib-muted'}`}
    >
      {count > 0 ? t('reader.phone.marks.tabLabel', { label, count }) : label}
    </button>
  )

  return (
    <MobileSheet title={tab === 'bookmarks' ? t('reader.phone.marks.bookmarks') : t('reader.phone.marks.notes')} onClose={onClose}>
      <div role="tablist" className="m-3 flex gap-1 rounded-xl bg-lib-hint p-1">
        {tabButton('bookmarks', t('reader.phone.marks.bookmarks'), bookmarks.length)}
        {tabButton('notes', t('reader.phone.marks.notes'), highlights.length)}
      </div>

      {tab === 'bookmarks' ? (
        <>
          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={onToggleBookmark}
              className="min-h-[44px] w-full rounded-xl border border-lib-border text-[14px] font-semibold text-lib-text-strong"
            >
              {currentPlaceBookmarked ? t('reader.phone.marks.removeHere') : t('reader.phone.marks.addHere')}
            </button>
          </div>
          {bookmarks.length === 0 ? (
            <p className="px-4 py-6 text-[14px] text-lib-muted">{t('reader.phone.marks.noBookmarks')}</p>
          ) : (
            bookmarks.map((bookmark) => (
              <MobileSheetRow
                key={bookmark.id}
                onSelect={() => {
                  onJumpBookmark(bookmark)
                  onClose()
                }}
                trailing={
                  <button
                    type="button"
                    aria-label={t('reader.phone.marks.removeBookmark', { label: bookmark.label })}
                    onClick={() => onDeleteBookmark(bookmark.id)}
                    className="min-h-[44px] min-w-[44px] px-3 text-[13px] font-semibold text-lib-muted"
                  >
                    {t('reader.phone.marks.remove')}
                  </button>
                }
              >
                <span className="block truncate font-semibold text-lib-text-strong">{bookmark.label}</span>
                {bookmark.excerpt ? <span className="block truncate text-[13px] text-lib-muted">{bookmark.excerpt}</span> : null}
              </MobileSheetRow>
            ))
          )}
        </>
      ) : highlights.length === 0 ? (
        <p className="px-4 py-6 text-[14px] text-lib-muted">{t('reader.phone.marks.noNotes')}</p>
      ) : (
        highlights.map((highlight) => (
          <MobileSheetRow
            key={highlight.id}
            onSelect={() => {
              onJumpHighlight(highlight)
              onClose()
            }}
            trailing={
              onOpenHighlight ? (
                <button
                  type="button"
                  aria-label={t('reader.phone.marks.edit')}
                  onClick={() => onOpenHighlight(highlight)}
                  className="min-h-[44px] min-w-[44px] px-3 text-[13px] font-semibold text-lib-muted"
                >
                  {t('reader.phone.marks.edit')}
                </button>
              ) : undefined
            }
          >
            <span className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: highlight.colorHex || 'transparent' }} />
              <span className="text-[12px] font-semibold text-lib-faint uppercase">{KIND_LABEL[highlight.styleKind] ?? highlight.styleKind}</span>
            </span>
            {highlight.selectionText?.highlight ? (
              <span className="mt-0.5 line-clamp-2 block text-[14px] text-lib-text">{highlight.selectionText.highlight}</span>
            ) : null}
            {highlight.note?.trim() ? <span className="mt-0.5 line-clamp-2 block text-[13px] text-lib-muted">{highlight.note}</span> : null}
          </MobileSheetRow>
        ))
      )}
    </MobileSheet>
  )
}
