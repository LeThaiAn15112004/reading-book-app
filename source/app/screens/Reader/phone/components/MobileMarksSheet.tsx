import { useState } from 'react'
import type { MessageKey, ReaderHighlightBase } from '@core'
import { useT } from '../../../../i18n'
import type { SurfaceBookmarks } from '../logic/readingSurface'
import { MobileReaderIcon } from './MobileReaderIcons'
import { MobileSheet, MobileSheetRow } from './MobileSheet'

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

const trailingButton =
  'focus-ring flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-lib-muted active:bg-lib-hint'

/**
 * Bookmarks and notes as one bottom sheet (spec 008 T103; spec 019). Everything comes from the reading surface; a
 * book without bookmarks (TXT) shows its notes only. Opening a note's panel keeps this sheet under it, so Back closes
 * the mark panel first, then this sheet (Story 1, scenario 2).
 */
export function MobileMarksSheet({
  bookmarks,
  marks,
  onJumpMark,
  onOpenMark,
  onClose,
}: {
  bookmarks?: SurfaceBookmarks
  marks: readonly ReaderHighlightBase[]
  onJumpMark: (id: string) => void
  onOpenMark: (id: string) => void
  onClose: () => void
}) {
  const t = useT()
  const [tab, setTab] = useState<Tab>(bookmarks ? 'bookmarks' : 'notes')
  const tabButton = (id: Tab, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`focus-ring min-h-[44px] flex-1 rounded-lg text-[14px] font-semibold ${tab === id ? 'bg-lib-surface text-lib-text-strong' : 'text-lib-muted'}`}
    >
      {count > 0 ? t('reader.phone.marks.tabLabel', { label, count }) : label}
    </button>
  )

  return (
    <MobileSheet title={tab === 'bookmarks' ? t('reader.phone.marks.bookmarks') : t('reader.phone.marks.notes')} onClose={onClose}>
      {bookmarks ? (
        <div role="tablist" className="m-3 flex gap-1 rounded-xl bg-lib-hint p-1">
          {tabButton('bookmarks', t('reader.phone.marks.bookmarks'), bookmarks.list.length)}
          {tabButton('notes', t('reader.phone.marks.notes'), marks.length)}
        </div>
      ) : null}

      {tab === 'bookmarks' && bookmarks ? (
        <>
          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={bookmarks.toggle}
              className="focus-ring flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-lib-border text-[14px] font-semibold text-lib-text-strong"
            >
              <MobileReaderIcon name={bookmarks.isHere ? 'bookmarkFilled' : 'bookmark'} size={20} />
              {bookmarks.isHere ? t('reader.phone.marks.removeHere') : t('reader.phone.marks.addHere')}
            </button>
          </div>
          {bookmarks.list.length === 0 ? (
            <p className="px-4 py-6 text-[14px] text-lib-muted">{t('reader.phone.marks.noBookmarks')}</p>
          ) : (
            bookmarks.list.map((bookmark) => (
              <MobileSheetRow
                key={bookmark.id}
                onSelect={() => {
                  bookmarks.jump(bookmark)
                  onClose()
                }}
                trailing={
                  <button
                    type="button"
                    aria-label={t('reader.phone.marks.removeBookmark', { label: bookmark.label })}
                    onClick={() => bookmarks.remove(bookmark.id)}
                    className={trailingButton}
                  >
                    <MobileReaderIcon name="delete" size={20} />
                  </button>
                }
              >
                <span className="block truncate font-semibold text-lib-text-strong">{bookmark.label}</span>
                {bookmark.excerpt ? <span className="block truncate text-[13px] text-lib-muted">{bookmark.excerpt}</span> : null}
              </MobileSheetRow>
            ))
          )}
        </>
      ) : marks.length === 0 ? (
        <p className="px-4 py-6 text-[14px] text-lib-muted">{t('reader.phone.marks.noNotes')}</p>
      ) : (
        marks.map((highlight) => (
          <MobileSheetRow
            key={highlight.id}
            onSelect={() => {
              onJumpMark(highlight.id)
              onClose()
            }}
            trailing={
              <button type="button" aria-label={t('reader.phone.marks.edit')} onClick={() => onOpenMark(highlight.id)} className={trailingButton}>
                <MobileReaderIcon name="edit" size={20} />
              </button>
            }
          >
            <span className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: highlight.colorHex || 'transparent' }} />
              <span className="text-[12px] font-semibold text-lib-faint uppercase">
                {KIND_LABEL[highlight.styleKind] ? t(KIND_LABEL[highlight.styleKind]!) : highlight.styleKind}
              </span>
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
