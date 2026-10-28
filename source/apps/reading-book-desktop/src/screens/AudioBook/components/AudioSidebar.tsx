import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  chapterIndexAt,
  formatPlaybackTime,
  groupNotesByTrack,
  resolveBookmarkTarget,
  trackDurationLabel,
  trackNumberLabel,
  type AudioBookmark,
  type TrackNoteGroup,
} from '@reading-book/book-reader-sdk'
import type { SidebarTab } from '../../Reader/components/sidebar'
import { SIDEBAR_RAIL_WIDTH_PX, SIDEBAR_TAB_LABEL } from '../../Reader/components/sidebar/sidebarTabs'
import { selectNoteGroupOpen, useNoteGroupsStore } from '../logic/audioNoteGroupsStore'
import { useNoteMenuStore } from '../logic/audioNoteMenuStore'
import { selectCanAddNote, useAudioPlayerStore } from '../logic/audioPlayerStore'
import { TranscriptPanel } from './TranscriptPanel'

const EMPTY = 'm-0 px-2 py-4 text-sm leading-relaxed text-lib-muted'

/** Progress inside the current chapter only; the one row that re-renders with the playback position. */
function CurrentChapterBar({ start, end }: { start: number; end: number }) {
  const position = useAudioPlayerStore((s) => s.positionSeconds)
  const pct = end > start ? Math.min(100, Math.max(0, ((position - start) / (end - start)) * 100)) : 0
  return (
    <span className="mt-1 block h-[3px] overflow-hidden rounded-sm bg-lib-border" aria-hidden>
      <span className="block h-full bg-lib-accent" style={{ width: `${pct}%` }} />
    </span>
  )
}

/** Contents: the chapters the file declares. */
function ChaptersTab() {
  const chapters = useAudioPlayerStore((s) => s.chapters)
  const status = useAudioPlayerStore((s) => s.chapterStatus)
  const reason = useAudioPlayerStore((s) => s.chapterReason)
  // A number: the list re-renders only when the chapter changes, not on every tick.
  const currentIndex = useAudioPlayerStore((s) => chapterIndexAt(s.chapters, s.positionSeconds))
  const goToChapter = useAudioPlayerStore((s) => s.goToChapter)
  const currentRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [currentIndex])

  if (status === 'pending-duration') return <p className={EMPTY}>Reading chapters…</p>
  if (status === 'invalid') {
    return (
      <p className={EMPTY}>
        The chapter list in this file could not be trusted{reason ? ` (${reason})` : ''}, so it was ignored. Playback and
        Book progress work normally.
      </p>
    )
  }
  if (status !== 'ok') {
    return (
      <p className={EMPTY}>
        This audiobook has no chapter information. Playback, Book progress and bookmarks work normally; chapters are only
        shown when the file declares them.
      </p>
    )
  }
  return (
    <ol className="m-0 list-none p-0" aria-label="Chapters">
      {chapters.map((c, i) => {
        const current = i === currentIndex
        return (
          <li key={c.id}>
            <button
              ref={current ? currentRef : undefined}
              type="button"
              aria-current={current ? 'true' : undefined}
              className={`flex w-full cursor-pointer items-start gap-3 rounded-lg border-none bg-transparent px-2.5 py-2 text-left hover:bg-lib-surface-hover ${
                current ? '!bg-lib-accent-soft' : ''
              }`}
              onClick={() => goToChapter(c.id)}
            >
              <span className={`w-6 shrink-0 pt-0.5 text-xs tabular-nums ${current ? 'text-lib-accent' : 'text-lib-faint'}`}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm ${current ? 'font-semibold text-lib-text-strong' : 'text-lib-text'}`}>{c.title}</span>
                {current ? <CurrentChapterBar start={c.startSeconds} end={c.endSeconds} /> : null}
              </span>
              <span className="shrink-0 pt-0.5 text-xs tabular-nums text-lib-muted">
                {formatPlaybackTime(c.endSeconds - c.startSeconds)}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Contents of a MULTI-TRACK audiobook: the tracks picked from the ZIP, in playback order. Same row look as the chapter list.
 * Clicking another track plays it from its start (the play state is kept); the current track ignores clicks.
 */
function TracksTab() {
  const tracks = useAudioPlayerStore((s) => s.tracks)
  const trackIndex = useAudioPlayerStore((s) => s.trackIndex)
  const trackErrors = useAudioPlayerStore((s) => s.trackErrors)
  // The element's duration for the current track (a number: the list re-renders on a change, not on every tick).
  const currentDuration = useAudioPlayerStore((s) => s.durationSeconds)
  const goToTrack = useAudioPlayerStore((s) => s.goToTrack)
  const currentRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [trackIndex])

  return (
    <>
      <p className="m-0 px-2 pb-2 text-xs text-lib-muted">{tracks.length} tracks</p>
      <ol className="m-0 list-none p-0" aria-label="Tracks">
        {tracks.map((t, i) => {
          const current = i === trackIndex
          const failed = trackErrors.has(t.id)
          const duration = current ? (currentDuration ?? t.durationSeconds) : t.durationSeconds
          return (
            <li key={t.id} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 40px' } as CSSProperties}>
              <button
                ref={current ? currentRef : undefined}
                type="button"
                aria-current={current ? 'true' : undefined}
                title={t.title}
                className={`flex w-full cursor-pointer items-start gap-3 rounded-lg border-none bg-transparent px-2.5 py-2 text-left hover:bg-lib-surface-hover ${
                  current ? '!bg-lib-accent-soft' : ''
                }`}
                onClick={() => goToTrack(i)}
              >
                <span className={`w-6 shrink-0 pt-0.5 text-xs tabular-nums ${current ? 'text-lib-accent' : 'text-lib-faint'}`}>
                  {trackNumberLabel(i)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${current ? 'font-semibold text-lib-text-strong' : 'text-lib-text'}`}>{t.title}</span>
                  {current && !failed && duration ? <CurrentChapterBar start={0} end={duration} /> : null}
                </span>
                {failed ? (
                  <span className="shrink-0 pt-0.5 text-xs text-amber-300">⚠ Can't play</span>
                ) : (
                  <span className="shrink-0 pt-0.5 text-xs tabular-nums text-lib-muted">{trackDurationLabel(duration)}</span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </>
  )
}

/** True while playback is at this note (±1.5 s). A boolean selector: the card re-renders only when it flips, not per tick. */
function useIsHere(at: number, trackId: string | undefined): boolean {
  // A track Note is "here" only while ITS track is the current one (its second is relative to that track).
  return useAudioPlayerStore(
    (s) => (trackId === undefined || s.tracks[s.trackIndex]?.id === trackId) && Math.abs(s.positionSeconds - at) < 1.5,
  )
}

/**
 * One note as a card (same look as the text reader's bookmark cards): time, text or label, chapter (single-file) or
 * "NN · track title" (multi-track), created date, ⋮. `at` is a position in the file, or inside the Note's track.
 */
function NoteCard({ note: n, at, chapterTitle }: { note: AudioBookmark; at: number; chapterTitle: string | undefined }) {
  const goToNote = useAudioPlayerStore((s) => s.goToNote)
  const openFor = useNoteMenuStore((s) => s.openFor)
  const isHere = useIsHere(at, n.trackId)
  const time = formatPlaybackTime(at)
  const created = n.createdAt ? new Date(n.createdAt) : null
  return (
    <li
      data-note-card
      className={`flex items-start gap-1 rounded-lg border p-3 transition-colors ${
        isHere ? 'border-lib-accent bg-lib-accent-soft' : 'border-lib-border-soft bg-lib-surface hover:border-lib-border hover:bg-lib-surface-hover'
      }`}
    >
      <button
        type="button"
        className="min-w-0 flex-1 cursor-pointer border-none bg-transparent p-0 text-left outline-none focus-visible:outline-none"
        aria-label={`Seek to note at ${time}`}
        onClick={() => goToNote(n.id)}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="inline-flex shrink-0 items-center rounded-full bg-lib-accent/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-lib-accent">
            {time}
          </span>
          {chapterTitle ? <span className="truncate text-[11px] font-medium text-lib-muted">{chapterTitle}</span> : null}
          {isHere ? (
            <span className="ml-auto inline-flex shrink-0 items-center rounded-full bg-lib-accent/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-lib-accent uppercase">
              Here
            </span>
          ) : null}
        </span>
        <span className={`mt-1.5 line-clamp-4 block text-sm leading-snug break-words ${n.note ? 'text-lib-text' : 'text-lib-muted italic'}`}>
          {n.note ?? 'No text'}
        </span>
        {created && !Number.isNaN(created.getTime()) ? (
          <span className="mt-1 block text-[11px] text-lib-faint">{created.toLocaleString()}</span>
        ) : null}
      </button>
      <button
        type="button"
        className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-base leading-none text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong"
        aria-label={`Note actions for ${time}`}
        aria-haspopup="menu"
        title="Note actions"
        onClick={(e) => openFor(n.id, e.currentTarget)}
      >
        ⋮
      </button>
    </li>
  )
}

/**
 * One track of a multi-track audiobook that has Notes: a header button (number, title, how many Notes, "Playing" when it is the
 * current track) that opens and closes the track's Notes. A closed row renders only its header. The Notes inside are the usual
 * `NoteCard`s (jump, ⋮ menu, "Here"); the header already names the track, so a card carries no track caption.
 */
function TrackNoteGroupRow({ group, playing }: { group: TrackNoteGroup; playing: boolean }) {
  const open = useNoteGroupsStore(selectNoteGroupOpen(group.trackId))
  const toggle = useNoteGroupsStore((s) => s.toggle)
  const listId = `audio-note-group-${group.trackId}`
  const noteWord = group.count === 1 ? 'note' : 'notes'
  return (
    <li data-note-group={group.trackId} className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-current={playing ? 'true' : undefined}
        aria-label={`Track ${group.index + 1}, ${group.track.title}, ${group.count} ${noteWord}`}
        title={group.track.title}
        className={`flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-left hover:bg-lib-surface-hover ${
          playing ? 'border-lib-accent bg-lib-accent-soft' : 'border-lib-border-soft bg-lib-surface'
        }`}
        onClick={() => toggle(group.trackId)}
      >
        <span className="w-4 shrink-0 text-xs text-lib-muted" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className={`w-6 shrink-0 text-xs tabular-nums ${playing ? 'text-lib-accent' : 'text-lib-faint'}`}>{trackNumberLabel(group.index)}</span>
        <span className={`min-w-0 flex-1 truncate text-sm ${playing ? 'font-semibold text-lib-text-strong' : 'text-lib-text'}`}>{group.track.title}</span>
        {playing ? (
          <span className="inline-flex shrink-0 items-center rounded-full bg-lib-accent/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-lib-accent uppercase">
            Playing
          </span>
        ) : null}
        <span className="inline-flex shrink-0 items-center rounded-full bg-lib-accent/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-lib-accent">
          {group.count}
        </span>
      </button>
      {open ? (
        <ul id={listId} className="m-0 flex list-none flex-col gap-2 p-0 pl-3" aria-label={`Notes in ${group.track.title}`}>
          {group.notes.map((n) => (
            <NoteCard key={n.id} note={n} at={n.positionSeconds} chapterTitle={undefined} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/** Notes: marked positions of this audiobook, each with optional text. The same list is drawn as markers on the timeline. */
function NotesTab() {
  const notes = useAudioPlayerStore((s) => s.notes)
  const chapters = useAudioPlayerStore((s) => s.chapters)
  const status = useAudioPlayerStore((s) => s.chapterStatus)
  const duration = useAudioPlayerStore((s) => s.durationSeconds)
  const tracks = useAudioPlayerStore((s) => s.tracks)
  const notesUnavailable = useAudioPlayerStore((s) => s.notesUnavailable)
  // A string: the "Playing" mark changes only when the track does, not on every playback tick.
  const currentTrackId = useAudioPlayerStore((s) => (s.tracks.length > 0 ? s.tracks[s.trackIndex]?.id : undefined))
  const canAddNote = useAudioPlayerStore(selectCanAddNote)
  const addNote = useAudioPlayerStore((s) => s.addNote)
  const ensureSeeded = useNoteGroupsStore((s) => s.ensureSeeded)
  const openFor = useNoteMenuStore((s) => s.openFor)
  const known = status === 'ok' ? chapters : []
  const multiTrack = tracks.length > 0
  // Multi-track only: one group per track that has Notes (a single-file audiobook keeps its flat list).
  const groups = useMemo(() => (multiTrack ? groupNotesByTrack(notes, tracks) : []), [multiTrack, notes, tracks])

  // The first time this tab is shown for an audiobook, the playing track's row is open; the store ignores later calls.
  useEffect(() => {
    if (multiTrack) ensureSeeded(currentTrackId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeds once per mount, with the track playing when the tab appears
  }, [multiTrack, ensureSeeded])

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={!canAddNote}
        title={canAddNote ? undefined : 'A Note can be added once the track is playing normally'}
        className="h-9 w-full cursor-pointer rounded-lg border border-lib-accent-ring bg-lib-accent-soft text-sm font-semibold text-lib-accent hover:bg-lib-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
        onClick={(e) => {
          const id = addNote()
          if (id) openFor(id, e.currentTarget, 'edit')
        }}
      >
        + Note at current position
      </button>
      {multiTrack && notesUnavailable ? (
        <p className={EMPTY}>Your Notes could not be loaded, so they are not shown and cannot be changed right now. Reopen the audiobook to try again.</p>
      ) : notes.length === 0 ? (
        <p className={EMPTY}>
          {multiTrack
            ? 'No notes yet. Add one to mark this exact spot in the current track, with or without text. Notes from every track appear here.'
            : 'No notes yet. Add one to mark this exact spot, with or without text.'}
        </p>
      ) : multiTrack ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Tracks with notes">
          {groups.map((g) => (
            <TrackNoteGroupRow key={g.trackId} group={g} playing={g.trackId === currentTrackId} />
          ))}
        </ul>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Notes">
          {notes.map((n) => {
            const at = resolveBookmarkTarget(n, known, duration)
            const chapter = known[chapterIndexAt(known, at)]
            return <NoteCard key={n.id} note={n} at={at} chapterTitle={chapter?.title} />
          })}
        </ul>
      )}
    </div>
  )
}

function PanelBody({ tab, bookId }: { tab: SidebarTab; bookId: string }) {
  const multiTrack = useAudioPlayerStore((s) => s.tracks.length > 0)
  if (tab === 'chapters') return multiTrack ? <TracksTab /> : <ChaptersTab />
  if (tab === 'highlights') return <NotesTab />
  if (tab === 'transcript') return <TranscriptPanel bookId={bookId} />
  return <p className={EMPTY}>Attachments are not available for audiobooks.</p>
}

/**
 * The panel next to the icon rail — same look and behaviour as the text reader's sidebar (`TocSidebar`):
 * titled header with a close button, scrolling body, resizable edge. Contents and Notes are real;
 * Attachment says plainly that it does not exist for audio.
 */
export function AudioSidebarPanel({
  bookId,
  tab,
  open,
  panelWidth,
  isResizing,
  onClose,
  onResizePointerDown,
}: {
  bookId: string
  tab: SidebarTab
  open: boolean
  panelWidth: number
  isResizing: boolean
  onClose: () => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  if (!open) return null
  return (
    <aside
      data-audio-sidebar
      aria-label={SIDEBAR_TAB_LABEL[tab]}
      className="absolute inset-y-0 z-[160] flex flex-col border-y border-r border-lib-border border-l-0 bg-lib-surface-strong shadow-lg"
      style={{ left: SIDEBAR_RAIL_WIDTH_PX, width: panelWidth }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-lib-border-soft px-3 py-2.5">
        <h2 className="m-0 min-w-0 flex-1 truncate text-[15px] font-semibold text-lib-text-strong">{SIDEBAR_TAB_LABEL[tab]}</h2>
        <button
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-base text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong"
          type="button"
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-2.5">
        <PanelBody tab={tab} bookId={bookId} />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        className="absolute top-0 -right-1 bottom-0 z-[165] w-2 cursor-col-resize touch-none"
        onPointerDown={onResizePointerDown}
      >
        <span className={`absolute inset-y-0 right-1 w-px ${isResizing ? 'bg-lib-accent' : 'bg-lib-border-soft/80'}`} aria-hidden />
      </div>
    </aside>
  )
}
