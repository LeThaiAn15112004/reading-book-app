import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PLAYBACK_RATES, formatPlaybackTime } from '@reading-book/book-reader-sdk'
import { useOpenReading } from '../../chrome'
import { ReaderOpenStatus } from '../Reader/components/chrome'
import { useBookRelinkStore } from '../Reader/logic/bookRelink/bookRelinkStore'
import { useAudioPlayerStore } from './logic/audioPlayerStore'

const BUTTON =
  'inline-flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border border-lib-border bg-lib-surface px-3 text-sm font-semibold text-lib-text hover:bg-lib-surface-hover disabled:cursor-default disabled:opacity-50'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
}

/** Audiobook player (MP3). Mounted by `ReaderRoute` instead of `ReaderScreen` for audio books. */
export function AudioBookScreen({ bookId }: { bookId: string }) {
  const navigate = useNavigate()
  const { ensureTab, updateBookTitle } = useOpenReading()
  const s = useAudioPlayerStore()
  const { load, dispose, toggle, seekTo, skipBy, setRate } = s
  const relink = useBookRelinkStore()
  // While the slider is dragged its own value is shown; the seek is committed on release.
  const [dragValue, setDragValue] = useState<number | null>(null)

  useEffect(() => {
    ensureTab(bookId)
    void load(bookId)
    return () => {
      void dispose()
    }
  }, [bookId, ensureTab, load, dispose])

  useEffect(() => {
    if (s.status === 'ready' && s.title) updateBookTitle(bookId, s.title)
  }, [bookId, s.status, s.title, updateBookTitle])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  const leave = useCallback(async () => {
    await dispose()
    navigate('/library')
  }, [dispose, navigate])

  const retry = useCallback(() => void load(bookId), [load, bookId])

  if (s.status === 'idle' || s.status === 'loading') {
    return <ReaderOpenStatus status="loading" onRetry={retry} onBack={() => void leave()} />
  }
  if (s.status === 'error') {
    return (
      <ReaderOpenStatus
        status="error"
        message={s.errorMessage}
        onRetry={retry}
        onBack={() => void leave()}
        onLocate={
          s.errorCode === 'missing_file'
            ? () => {
                void relink.locate(bookId).then((linked) => {
                  if (linked) retry()
                })
              }
            : undefined
        }
        locating={relink.locating}
        locateMessage={relink.notice?.bookId === bookId ? relink.notice.text : null}
      />
    )
  }

  const duration = s.durationSeconds
  const shown = dragValue ?? s.positionSeconds
  const commit = () => {
    if (dragValue !== null) seekTo(dragValue)
    setDragValue(null)
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-auto px-6 py-8 text-lib-text">
      <button type="button" className={`${BUTTON} absolute top-4 left-4 text-xs`} onClick={() => void leave()}>
        ← Library
      </button>

      {s.coverUrl ? (
        <img src={s.coverUrl} alt="" className="size-48 rounded-xl border border-lib-border object-cover shadow-xl" />
      ) : (
        <div
          className="flex size-48 items-center justify-center rounded-xl border border-lib-border bg-lib-surface text-5xl"
          aria-hidden
        >
          🎧
        </div>
      )}

      <div className="max-w-xl text-center">
        <h1 className="m-0 text-xl font-semibold text-lib-text-strong">{s.title}</h1>
        {s.author ? <p className="mt-1 mb-0 text-sm text-lib-muted">{s.author}</p> : null}
      </div>

      <div className="flex w-full max-w-xl flex-col gap-1">
        <input
          type="range"
          aria-label="Seek"
          className="w-full cursor-pointer accent-[var(--lib-accent,currentColor)] disabled:cursor-default"
          min={0}
          max={duration ?? Math.max(shown, 1)}
          step={1}
          value={Math.min(shown, duration ?? shown)}
          disabled={duration === null}
          onChange={(e) => setDragValue(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <div className="flex justify-between text-xs tabular-nums text-lib-muted">
          <span>{formatPlaybackTime(shown)}</span>
          <span>{duration === null ? '--:--' : formatPlaybackTime(duration)}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" className={BUTTON} aria-label="Back 15 seconds" onClick={() => skipBy(-15)}>
          −15s
        </button>
        <button
          type="button"
          className={`${BUTTON} size-14 text-lg`}
          aria-label={s.playing ? 'Pause' : 'Play'}
          onClick={toggle}
        >
          {s.playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className={BUTTON} aria-label="Forward 30 seconds" onClick={() => skipBy(30)}>
          +30s
        </button>
        <label className="flex items-center gap-2 text-sm text-lib-muted">
          <span className="sr-only">Playback speed</span>
          <select
            className="h-11 cursor-pointer rounded-full border border-lib-border bg-lib-surface px-3 text-sm font-semibold text-lib-text"
            value={s.playbackRate}
            onChange={(e) => setRate(Number(e.target.value))}
          >
            {(PLAYBACK_RATES.includes(s.playbackRate) ? PLAYBACK_RATES : [...PLAYBACK_RATES, s.playbackRate]).map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="m-0 h-5 text-xs text-lib-muted" aria-live="polite">
        {s.buffering ? 'Loading…' : s.ended ? 'Finished' : ''}
      </p>
    </main>
  )
}
