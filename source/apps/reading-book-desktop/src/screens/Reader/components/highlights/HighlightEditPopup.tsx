import { useLayoutEffect, useRef, useState } from 'react'
import { HIGHLIGHT_TAG_PRESETS, type ReaderHighlight } from '@reading-book/book-reader-sdk'
import type { ViewportRectLike } from '../../../../reader/renderers/epub'
import {
  highlightPopoverPosition,
  useDismissOnOutsideOrEscape,
} from '../../logic'
import { HighlightColorPicker } from './HighlightColorPicker'

type HighlightEditPopupProps = {
  anchorRect: ViewportRectLike
  highlight: ReaderHighlight
  onChangeColor: (colorHex: string) => void
  onToggleUnderline: (isUnderline: boolean) => void
  onToggleStrikethrough: (isStrikethrough: boolean) => void
  onChangeNote: (note: string) => void
  onChangeTags: (tags: string[]) => void
  onCopy: () => void
  onDelete: () => void
  onClose: () => void
}

const FALLBACK_SIZE = { width: 260, height: 220 }

export function HighlightEditPopup({
  anchorRect,
  highlight,
  onChangeColor,
  onToggleUnderline,
  onToggleStrikethrough,
  onChangeNote,
  onChangeTags,
  onCopy,
  onDelete,
  onClose,
}: HighlightEditPopupProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState(FALLBACK_SIZE)
  const [noteDraft, setNoteDraft] = useState(highlight.note ?? '')
  const [tagDraft, setTagDraft] = useState('')

  // ResizeObserver (not just the anchor/highlight deps) since the color picker below can expand
  // its own hue/alpha panel independently — `highlightPopoverPosition` needs the up-to-date size
  // to keep the popup from overflowing off-screen when that happens.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [anchorRect.top, anchorRect.left, highlight.id])

  useDismissOnOutsideOrEscape(containerRef, onClose)

  const { top, left } = highlightPopoverPosition(anchorRect, size, {
    width: window.innerWidth,
    height: window.innerHeight,
  })

  function addTag(rawTag: string) {
    const tag = rawTag.trim()
    if (!tag || highlight.tags.includes(tag)) return
    onChangeTags([...highlight.tags, tag])
  }

  function removeTag(tag: string) {
    onChangeTags(highlight.tags.filter((t) => t !== tag))
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-[400] flex w-[260px] flex-col gap-3 rounded-xl border border-lib-border bg-lib-surface-strong p-3 shadow-xl"
      style={{ top, left }}
      role="dialog"
      aria-label="Edit highlight"
    >
      <div className="flex items-start gap-1.5">
        <HighlightColorPicker
          value={highlight.colorHex}
          styleKind={highlight.styleKind}
          onChange={onChangeColor}
        />
        <button
          type="button"
          title="Toggle underline"
          aria-pressed={highlight.styleKind === 'underline'}
          className="ml-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-lib-border text-[12px] font-bold text-lib-text underline"
          onClick={() => onToggleUnderline(highlight.styleKind !== 'underline')}
        >
          U
        </button>
        <button
          type="button"
          title="Toggle strikethrough"
          aria-pressed={highlight.styleKind === 'strikethrough'}
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-lib-border text-[12px] font-bold text-lib-text line-through"
          onClick={() => onToggleStrikethrough(highlight.styleKind !== 'strikethrough')}
        >
          S
        </button>
      </div>

      <textarea
        value={noteDraft}
        onChange={(e) => setNoteDraft(e.target.value)}
        onBlur={() => {
          if (noteDraft !== (highlight.note ?? '')) onChangeNote(noteDraft)
        }}
        placeholder="Add a note…"
        rows={3}
        className="w-full resize-none rounded-md border border-lib-border bg-lib-bg-mid/50 p-2 text-[12px] text-lib-text"
      />

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          {highlight.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full border border-lib-border bg-lib-bg-mid/50 px-2 py-0.5 text-[11px] text-lib-text"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                className="cursor-pointer text-lib-muted"
                onClick={() => removeTag(tag)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {HIGHLIGHT_TAG_PRESETS.filter((t) => !highlight.tags.includes(t)).map((tag) => (
            <button
              key={tag}
              type="button"
              className="cursor-pointer rounded-full border border-dashed border-lib-border px-2 py-0.5 text-[11px] text-lib-muted"
              onClick={() => addTag(tag)}
            >
              + {tag}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              addTag(tagDraft)
              setTagDraft('')
            }
          }}
          placeholder="Add a tag…"
          className="h-7 w-full rounded-md border border-lib-border bg-lib-bg-mid/50 px-2 text-[12px] text-lib-text"
        />
      </div>

      <button
        type="button"
        className="w-full cursor-pointer rounded-lg border border-lib-border px-3 py-1.5 text-[12px] font-semibold text-lib-text"
        onClick={onCopy}
      >
        Copy
      </button>
      <button
        type="button"
        className="w-full cursor-pointer rounded-lg border border-red-400/45 bg-red-400/15 px-3 py-1.5 text-[12px] font-semibold text-red-400"
        onClick={onDelete}
      >
        Delete highlight
      </button>
    </div>
  )
}
