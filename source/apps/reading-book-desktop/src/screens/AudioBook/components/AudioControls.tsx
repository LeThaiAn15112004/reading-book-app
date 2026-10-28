import { useEffect, useState } from 'react'
import { PLAYBACK_RATES, formatPlaybackTime } from '@reading-book/book-reader-sdk'
import { useNoteMenuStore } from '../logic/audioNoteMenuStore'
import { AudioSelect, type AudioSelectOption } from './AudioSelect'
import { SLEEP_MINUTES, selectCanAddNote, useAudioPlayerStore, type SleepOption } from '../logic/audioPlayerStore'

const ROUND =
  'inline-flex cursor-pointer items-center justify-center rounded-full border border-lib-border bg-lib-surface text-sm font-semibold text-lib-text hover:bg-lib-surface-hover disabled:cursor-not-allowed disabled:opacity-40'
const PILL =
  'inline-flex h-9 items-center gap-2 rounded-full border border-lib-border bg-lib-surface px-3 text-xs font-semibold text-lib-muted'

function optionValue(sleep: SleepOption): string {
  return sleep.kind === 'minutes' ? String(sleep.minutes) : sleep.kind
}

function SleepTimer() {
  const sleep = useAudioPlayerStore((s) => s.sleep)
  const endsAt = useAudioPlayerStore((s) => s.sleepEndsAt)
  const hasChapters = useAudioPlayerStore((s) => s.chapterStatus === 'ok')
  const multiTrack = useAudioPlayerStore((s) => s.tracks.length > 0)
  const setSleep = useAudioPlayerStore((s) => s.setSleep)
  const [now, setNow] = useState(() => Date.now())

  // Only a running countdown ticks; nothing re-renders per second otherwise.
  useEffect(() => {
    if (endsAt === null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [endsAt])

  const remaining = endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000))
  const options: AudioSelectOption[] = [
    { value: 'off', label: 'Off' },
    ...SLEEP_MINUTES.map((m) => ({ value: String(m), label: `${m} min` })),
    multiTrack
      ? { value: 'chapter', label: 'End of track' }
      : { value: 'chapter', label: 'End of chapter', disabled: !hasChapters, hint: 'Needs chapter information' },
  ]
  return (
    <AudioSelect
      label="Sleep"
      ariaLabel="Sleep timer"
      value={optionValue(sleep)}
      options={options}
      suffix={remaining !== null ? formatPlaybackTime(remaining) : null}
      onChange={(v) => {
        if (v === 'off') setSleep({ kind: 'off' })
        else if (v === 'chapter') setSleep({ kind: 'chapter' })
        else setSleep({ kind: 'minutes', minutes: Number(v) })
      }}
    />
  )
}

/** Transport (previous / −15 / play / +30 / next) and the secondary row (speed, sleep, bookmark, volume). */
export function AudioControls() {
  const playing = useAudioPlayerStore((s) => s.playing)
  const rate = useAudioPlayerStore((s) => s.playbackRate)
  const volume = useAudioPlayerStore((s) => s.volume)
  // Multi-track audiobooks: the two outer buttons switch TRACK (previous restarts the track when more than 3 s in).
  const multiTrack = useAudioPlayerStore((s) => s.tracks.length > 0)
  const onLastTrack = useAudioPlayerStore((s) => s.tracks.length > 0 && s.trackIndex >= s.tracks.length - 1)
  const hasChapters = useAudioPlayerStore((s) => s.chapterStatus === 'ok')
  const toggle = useAudioPlayerStore((s) => s.toggle)
  const skipBy = useAudioPlayerStore((s) => s.skipBy)
  const setRate = useAudioPlayerStore((s) => s.setRate)
  const setVolume = useAudioPlayerStore((s) => s.setVolume)
  const previousChapter = useAudioPlayerStore((s) => s.previousChapter)
  const nextChapter = useAudioPlayerStore((s) => s.nextChapter)
  const addNote = useAudioPlayerStore((s) => s.addNote)
  // The control is always there; it is disabled when there is no valid current position (a track change in flight, a track that
  // failed, the Notes could not be read) — see `selectCanAddNote`.
  const canAddNote = useAudioPlayerStore(selectCanAddNote)
  const openNoteMenu = useNoteMenuStore((s) => s.openFor)
  const noChapters = hasChapters || multiTrack ? undefined : 'No chapter information in this audiobook'
  const previousLabel = multiTrack ? 'Previous track' : 'Previous chapter'
  const nextLabel = multiTrack ? 'Next track' : 'Next chapter'

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center justify-center gap-3">
        <button type="button" className={`${ROUND} size-11 border-transparent bg-transparent`} aria-label={previousLabel} title={noChapters ?? previousLabel} disabled={!hasChapters && !multiTrack} onClick={previousChapter}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><rect x="2" y="2" width="2" height="12" fill="currentColor" /><path d="M14 2 L5 8 L14 14 Z" fill="currentColor" /></svg>
        </button>
        <button type="button" className={`${ROUND} size-14`} aria-label="Back 15 seconds" title="Back 15 seconds" onClick={() => skipBy(-15)}>
          −15s
        </button>
        <button
          type="button"
          className="inline-flex size-[72px] cursor-pointer items-center justify-center rounded-full bg-lib-accent text-lib-on-accent shadow-lg hover:bg-lib-accent-hover active:scale-95"
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          onClick={toggle}
        >
          {playing ? (
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden><rect x="4" y="3" width="5" height="16" rx="1" fill="currentColor" /><rect x="13" y="3" width="5" height="16" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden><path d="M6 3 L19 11 L6 19 Z" fill="currentColor" /></svg>
          )}
        </button>
        <button type="button" className={`${ROUND} size-14`} aria-label="Forward 30 seconds" title="Forward 30 seconds" onClick={() => skipBy(30)}>
          +30s
        </button>
        <button type="button" className={`${ROUND} size-11 border-transparent bg-transparent`} aria-label={nextLabel} title={noChapters ?? nextLabel} disabled={(!hasChapters && !multiTrack) || onLastTrack} onClick={nextChapter}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><rect x="12" y="2" width="2" height="12" fill="currentColor" /><path d="M2 2 L11 8 L2 14 Z" fill="currentColor" /></svg>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <AudioSelect
          label="Speed"
          ariaLabel="Playback speed"
          value={String(rate)}
          valueLabel={`${rate}×`}
          options={(PLAYBACK_RATES.includes(rate) ? PLAYBACK_RATES : [...PLAYBACK_RATES, rate]).map((r) => ({ value: String(r), label: `${r}×` }))}
          onChange={(v) => setRate(Number(v))}
        />
        <SleepTimer />
        <button
          type="button"
          className={`${PILL} cursor-pointer hover:bg-lib-surface-hover disabled:cursor-not-allowed disabled:opacity-40`}
          title={canAddNote ? 'Mark this position with a note' : 'A Note can be added once the track is playing normally'}
          disabled={!canAddNote}
          onClick={(e) => {
            const id = addNote()
            if (id) openNoteMenu(id, e.currentTarget, 'edit')
          }}
        >
          + Note
        </button>
        <label className={PILL}>
          <span>Vol</span>
          <input
            type="range"
            aria-label="Volume"
            className="w-24 cursor-pointer accent-[var(--lib-accent,currentColor)]"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  )
}
