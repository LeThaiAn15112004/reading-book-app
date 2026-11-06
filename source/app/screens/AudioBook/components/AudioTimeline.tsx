import { useMemo, useState, type KeyboardEvent } from 'react'
import {
  formatPlaybackTime,
  noteMarkerFraction,
  notesForTrack,
  resolveBookmarkTarget,
  timelineView,
  trackEyebrow,
  type ProgressScope,
} from '@reading-book/book-reader-sdk'
import { useNoteMenuStore } from '../logic/audioNoteMenuStore'
import { useAudioPlayerStore } from '../logic/audioPlayerStore'

const SCOPE_LABEL: Record<ProgressScope, string> = { book: 'Book', chapter: 'Chapter' }

/** Why Chapter scope is unavailable, or null when it is available. */
function chapterUnavailableReason(status: string, reason: string | null): string | null {
  if (status === 'ok') return null
  if (status === 'pending-duration') return 'Chapters are still loading'
  if (status === 'invalid') return `The chapter list in this file could not be trusted${reason ? ` (${reason})` : ''}`
  return 'This audiobook has no chapter information'
}

/** Book / Chapter selector: changes how the timeline is read, never where the audio is. */
export function ProgressScopeSelector() {
  const scope = useAudioPlayerStore((s) => s.scope)
  const status = useAudioPlayerStore((s) => s.chapterStatus)
  const reason = useAudioPlayerStore((s) => s.chapterReason)
  const setScope = useAudioPlayerStore((s) => s.setScope)
  const unavailable = chapterUnavailableReason(status, reason)
  const effective: ProgressScope = unavailable ? 'book' : scope

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    if (unavailable) return
    setScope(effective === 'book' ? 'chapter' : 'book')
  }

  return (
    <div
      role="radiogroup"
      aria-label="Progress scope"
      className="inline-flex rounded-full border border-lib-border bg-lib-surface p-0.5 text-xs font-semibold"
      onKeyDown={onKeyDown}
    >
      {(['book', 'chapter'] as const).map((value) => {
        const disabled = value === 'chapter' && unavailable !== null
        const checked = effective === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={disabled || undefined}
            tabIndex={checked ? 0 : -1}
            title={disabled ? (unavailable ?? undefined) : `Show ${SCOPE_LABEL[value].toLowerCase()} progress`}
            className={`h-7 min-w-16 rounded-full px-3 ${
              checked ? 'bg-lib-accent text-lib-on-accent' : 'text-lib-muted hover:text-lib-text'
            } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            onClick={() => {
              if (!disabled) setScope(value)
            }}
          >
            {SCOPE_LABEL[value]}
          </button>
        )
      })}
    </div>
  )
}

/** The seek bar and its three labels, for the chosen scope. Re-renders with the playback position. */
export function AudioTimeline() {
  const scope = useAudioPlayerStore((s) => s.scope)
  const position = useAudioPlayerStore((s) => s.positionSeconds)
  const duration = useAudioPlayerStore((s) => s.durationSeconds)
  const chapters = useAudioPlayerStore((s) => s.chapters)
  const buffering = useAudioPlayerStore((s) => s.buffering)
  const seekScoped = useAudioPlayerStore((s) => s.seekScoped)
  const notes = useAudioPlayerStore((s) => s.notes)
  const chapterStatus = useAudioPlayerStore((s) => s.chapterStatus)
  // Multi-track: the bar spans the CURRENT track (position and duration are the track's); no chapter ticks, no note markers.
  const trackLabel = useAudioPlayerStore((s) => trackEyebrow(s.trackIndex, s.tracks.length))
  // Multi-track: only the CURRENT track's Notes get markers (their seconds are relative to that track).
  const currentTrackId = useAudioPlayerStore((s) => (s.tracks.length > 0 ? s.tracks[s.trackIndex]?.id : undefined))
  const multiTrack = useAudioPlayerStore((s) => s.tracks.length > 0)
  const openNoteMenu = useNoteMenuStore((s) => s.openFor)
  // While the slider is dragged its own value is shown; the seek is committed on release.
  const [dragValue, setDragValue] = useState<number | null>(null)

  const view = useMemo(() => timelineView(scope, position, duration, chapters), [scope, position, duration, chapters])
  const ticks = useMemo(
    () =>
      duration && view?.scope === 'book'
        ? chapters.slice(1).map((c) => ({ id: c.id, title: c.title, pct: (c.startSeconds / duration) * 100 }))
        : [],
    [chapters, duration, view?.scope],
  )

  // One marker per note, from the SAME list as the sidebar. Positions follow the shown range (whole audio, or the
  // current chapter) and the real duration; a note that cannot be placed (unknown duration, outside the range) is not drawn.
  const markers = useMemo(() => {
    if (!view) return []
    const range = view.scope === 'chapter' ? { startSeconds: view.startSeconds, endSeconds: view.endSeconds } : undefined
    if (multiTrack) {
      if (currentTrackId === undefined) return []
      return notesForTrack(notes, currentTrackId).flatMap((n) => {
        const fraction = noteMarkerFraction(n.positionSeconds, duration)
        return fraction === null ? [] : [{ note: n, at: n.positionSeconds, fraction }]
      })
    }
    return notes.flatMap((n) => {
      const at = resolveBookmarkTarget(n, chapterStatus === 'ok' ? chapters : [], duration)
      const fraction = noteMarkerFraction(at, duration, range)
      return fraction === null ? [] : [{ note: n, at, fraction }]
    })
  }, [notes, chapters, chapterStatus, duration, view, multiTrack, currentTrackId])

  if (!view) {
    // Duration unknown (still loading, or the stream does not report one): nothing to seek on.
    return (
      <div className="flex w-full flex-col gap-2">
        <input type="range" aria-label="Seek" disabled className="w-full" min={0} max={1} value={0} readOnly />
        <div className="flex justify-between text-xs tabular-nums text-lib-muted">
          <span>--:--</span>
          <span>Duration unavailable</span>
          <span>--:--</span>
        </div>
      </div>
    )
  }

  const shown = Math.min(view.durationSeconds, dragValue ?? view.positionSeconds)
  const commit = () => {
    if (dragValue !== null) seekScoped(dragValue)
    setDragValue(null)
  }
  const label = trackLabel ?? (view.scope === 'chapter' ? 'Chapter' : 'Whole book')

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="relative flex h-6 items-center">
        {ticks.map((t) => (
          <span
            key={t.id}
            title={t.title}
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-2 w-0.5 -translate-y-1/2 rounded-sm bg-lib-text/50"
            style={{ left: `${t.pct}%` }}
          />
        ))}
        <input
          type="range"
          data-audio-seek
          aria-label={`Seek (${label.toLowerCase()})`}
          aria-valuetext={`${formatPlaybackTime(shown)} of ${formatPlaybackTime(view.durationSeconds)}`}
          className="relative w-full cursor-pointer accent-[var(--lib-accent,currentColor)]"
          min={0}
          max={view.durationSeconds}
          step={1}
          value={shown}
          onChange={(e) => setDragValue(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        {markers.map(({ note, at, fraction }) => (
          <button
            key={note.id}
            type="button"
            data-audio-note-marker={note.id}
            aria-label={`Note at ${formatPlaybackTime(at)}${note.note ? `: ${note.note}` : ''}`}
            aria-haspopup="menu"
            title={note.note ? `${formatPlaybackTime(at)} · ${note.note}` : `Note at ${formatPlaybackTime(at)}`}
            className="group absolute -top-1 z-[2] flex size-4 -translate-x-1/2 cursor-pointer items-center justify-center border-none bg-transparent p-0 hover:z-[3] focus-visible:z-[3] focus-visible:outline-none"
            // The native thumb's travel is inset by half its width at both ends; the marker uses the same inset.
            style={{ left: `calc(8px + (100% - 16px) * ${fraction})` }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              openNoteMenu(note.id, e.currentTarget)
            }}
          >
            <span className="block size-2.5 rotate-45 rounded-[2px] border-2 border-lib-bg-mid bg-lib-text-strong shadow group-hover:scale-125 group-focus-visible:ring-2 group-focus-visible:ring-lib-accent" aria-hidden />
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs tabular-nums text-lib-muted">
        <span data-audio-elapsed>{formatPlaybackTime(shown)}</span>
        <span>{buffering ? 'Loading…' : label}</span>
        <span data-audio-remaining>-{formatPlaybackTime(view.durationSeconds - shown)}</span>
      </div>
    </div>
  )
}
