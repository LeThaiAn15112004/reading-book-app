import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { MAX_NOTE_CHARS, formatPlaybackTime, trackNoteLabel } from '@reading-book/book-reader-sdk'
import { useDismissOnOutsideOrEscape } from '../../Reader/logic'
import { useNoteMenuStore } from '../logic/audioNoteMenuStore'
import { useAudioPlayerStore } from '../logic/audioPlayerStore'

const WIDTH = 264
const MARGIN = 8
const GAP = 6

const itemClass =
  'flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg border-none bg-transparent px-3 py-1.5 text-left text-sm font-medium text-lib-text transition-colors hover:bg-lib-surface-hover hover:text-lib-text-strong focus-visible:bg-lib-surface-hover focus-visible:outline-none'
const buttonClass =
  'inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-lib-border px-3 text-xs font-semibold text-lib-text hover:bg-lib-surface-hover'

/**
 * The one popover for a note — opened from a sidebar ⋮ button or a timeline marker alike (see
 * `useNoteMenuStore`). Actions: Add / Edit note (an inline editor), Seek to position, Delete note
 * (with a confirmation step). Portaled and clamped to the viewport; ↑ ↓ move, Enter chooses, Esc closes.
 */
export function AudioNoteMenu() {
  const open = useNoteMenuStore((s) => s.open)
  const note = useAudioPlayerStore((s) => (open ? s.notes.find((n) => n.id === open.noteId) : undefined))
  const close = useNoteMenuStore((s) => s.close)
  // The note was deleted (from anywhere): nothing left to manage.
  useEffect(() => {
    if (open && !note) close()
  }, [open, note, close])
  if (!open || !note) return null
  return <Popover key={`${open.noteId}:${open.mode === 'edit' ? 'e' : 'm'}`} />
}

function Popover() {
  const open = useNoteMenuStore((s) => s.open)!
  const { setMode, close } = useNoteMenuStore.getState()
  const note = useAudioPlayerStore((s) => s.notes.find((n) => n.id === open.noteId))!
  const goToNote = useAudioPlayerStore((s) => s.goToNote)
  const updateNote = useAudioPlayerStore((s) => s.updateNote)
  const removeNote = useAudioPlayerStore((s) => s.removeNote)
  // Multi-track: which track the Note belongs to ("12 · Title"), shown next to its time; `null` for a single-file Note.
  const trackLabel = useAudioPlayerStore((s) => trackNoteLabel(note, s.tracks))
  const ref = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const [draft, setDraft] = useState(note.note ?? '')

  useLayoutEffect(() => {
    const { anchor } = open
    const left = Math.min(Math.max(anchor.left + (anchor.right - anchor.left) / 2 - WIDTH / 2, MARGIN), window.innerWidth - WIDTH - MARGIN)
    const roomBelow = window.innerHeight - anchor.bottom
    const flip = roomBelow < 220 && anchor.top > roomBelow
    setPos(flip ? { left, bottom: window.innerHeight - anchor.top + GAP } : { left, top: anchor.bottom + GAP })
  }, [open])

  useDismissOnOutsideOrEscape(ref, close, { consumeEscape: true })

  useEffect(() => {
    if (!pos) return
    if (open.mode === 'edit') {
      textRef.current?.focus()
      textRef.current?.setSelectionRange(draft.length, draft.length)
    } else {
      const items = ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [data-focus-first]')
      // Confirm step: focus the safe choice (Cancel); menu: the first action.
      items?.[open.mode === 'confirm-delete' ? items.length - 1 : 0]?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus once when the popover appears / changes mode
  }, [pos])

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    if (items.length === 0) return
    e.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  const save = () => {
    updateNote(note.id, draft)
    close()
  }

  if (!pos) return null
  const time = formatPlaybackTime(note.positionSeconds)
  const where = trackLabel ? `${trackLabel} · ${time}` : time

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[420] rounded-xl border border-lib-border bg-lib-surface-strong p-1.5 shadow-xl backdrop-blur-md"
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: WIDTH }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onMenuKeyDown}
    >
      {open.mode === 'menu' ? (
        <div role="menu" aria-label={`Note at ${time}`}>
          <div className="px-3 pt-1.5 pb-1 text-[11px] font-bold tracking-wide text-lib-faint uppercase">Note · {where}</div>
          <button type="button" role="menuitem" className={itemClass} onClick={() => setMode('edit')}>
            {note.note ? 'Edit note' : 'Add note'}
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              goToNote(note.id)
              close()
            }}
          >
            Seek to position
          </button>
          <button type="button" role="menuitem" className={`${itemClass} !text-rose-300`} onClick={() => setMode('confirm-delete')}>
            Delete note
          </button>
        </div>
      ) : open.mode === 'edit' ? (
        <form
          role="dialog"
          aria-label={note.note ? 'Edit note' : 'Add note'}
          className="flex flex-col gap-2 p-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <label className="text-[11px] font-bold tracking-wide text-lib-faint uppercase" htmlFor="audio-note-text">
            Note · {where}
          </label>
          <textarea
            id="audio-note-text"
            ref={textRef}
            value={draft}
            maxLength={MAX_NOTE_CHARS}
            rows={4}
            placeholder="Optional — add some text"
            className="w-full resize-y rounded-lg border border-lib-border bg-lib-input p-2 text-sm text-lib-text outline-none focus:border-lib-accent-ring"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                save()
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass} onClick={close}>
              Cancel
            </button>
            <button type="submit" className={`${buttonClass} border-lib-accent-ring bg-lib-accent-soft text-lib-accent`}>
              Save
            </button>
          </div>
        </form>
      ) : (
        <div role="alertdialog" aria-label="Delete note" className="flex flex-col gap-2 p-1.5">
          <p className="m-0 px-1 text-sm text-lib-text">Delete the note at {time}?</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={`${buttonClass} border-rose-400/40 text-rose-300`}
              onClick={() => {
                removeNote(note.id)
                close()
              }}
            >
              Delete
            </button>
            <button type="button" data-focus-first className={buttonClass} onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
