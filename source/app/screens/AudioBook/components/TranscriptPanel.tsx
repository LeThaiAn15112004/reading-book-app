import { useEffect, useMemo, useRef, useState } from 'react'
import type { TranscriptionScope } from '../../../bridge'
import { useAudioPlayerStore } from '../logic/audioPlayerStore'
import { formatPassageTime, transcriptionErrorText } from '../logic/transcriptionMessages'
import { SEARCH_HIT_LIMIT, isActiveJob, useTranscriptStore } from '../logic/transcriptStore'

const EMPTY = 'm-0 px-2 py-3 text-sm leading-relaxed text-lib-muted'
const GHOST_BTN =
  'inline-flex h-8 cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-3 text-[13px] font-medium text-lib-muted transition-colors hover:text-lib-text-strong disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY_BTN =
  'inline-flex h-8 cursor-pointer items-center rounded-lg border-none bg-lib-accent px-3 text-[13px] font-semibold text-lib-bg-deep transition-colors hover:bg-lib-accent-hover disabled:cursor-not-allowed disabled:opacity-50'
const PILL = 'inline-flex items-center rounded-full bg-lib-accent/15 px-2 py-0.5 text-[11px] font-bold text-lib-accent'

type Confirm = 'delete' | 'restart' | null

function percent(done: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0
}

function ProgressBar({ label, done, total }: { label: string; done: number; total: number }) {
  const value = percent(done, total)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[12px] text-lib-muted">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 tabular-nums">{value}%</span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="h-1.5 overflow-hidden rounded-full bg-lib-border">
        <div className="h-full bg-lib-accent" style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

/** Inline confirmation (destructive actions ask first, like the Notes menu). */
function ConfirmBox({ message, confirmLabel, onConfirm, onCancel }: { message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="alertdialog" aria-label={message} className="flex flex-col gap-2 rounded-lg border border-lib-border bg-lib-surface p-3">
      <p className="m-0 text-sm text-lib-text">{message}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className={GHOST_BTN} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={`${GHOST_BTN} !border-rose-300/50 !text-rose-300`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}

/**
 * The Transcript tab (spec 004, US1): progress with Cancel while a job runs, then the passages in reading order (grouped by track
 * for a multi-track audiobook) with a "Partial" badge when the text does not cover everything, and the controls to resume an
 * interrupted job, re-run (replace) or delete — each destructive one after a confirmation. State comes from `transcriptStore`.
 */
export function TranscriptPanel({ bookId }: { bookId: string }) {
  void bookId
  const infoStatus = useTranscriptStore((s) => s.infoStatus)
  const info = useTranscriptStore((s) => s.info)
  const job = useTranscriptStore((s) => s.job)
  const passages = useTranscriptStore((s) => s.passages)
  const passagesStatus = useTranscriptStore((s) => s.passagesStatus)
  const truncated = useTranscriptStore((s) => s.passagesTruncated)
  const actionError = useTranscriptStore((s) => s.actionError)
  const refresh = useTranscriptStore((s) => s.refresh)
  const loadMore = useTranscriptStore((s) => s.loadMore)
  const activePassageId = useTranscriptStore((s) => s.activePassageId)
  const seekToPassage = useTranscriptStore((s) => s.seekToPassage)
  const searchQuery = useTranscriptStore((s) => s.searchQuery)
  const searchStatus = useTranscriptStore((s) => s.searchStatus)
  const searchHits = useTranscriptStore((s) => s.searchHits)
  const search = useTranscriptStore((s) => s.search)
  const clearSearch = useTranscriptStore((s) => s.clearSearch)
  const exporting = useTranscriptStore((s) => s.exporting)
  const exportSaved = useTranscriptStore((s) => s.exportSaved)
  const exportTranscript = useTranscriptStore((s) => s.exportTranscript)
  const start = useTranscriptStore((s) => s.start)
  const cancel = useTranscriptStore((s) => s.cancel)
  const remove = useTranscriptStore((s) => s.remove)
  const openDialog = useTranscriptStore((s) => s.openDialog)
  const tracks = useAudioPlayerStore((s) => s.tracks)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState(false)
  // Follow: keep the passage being spoken in view. A manual scroll switches it off; the Follow button (or playing from a passage)
  // switches it back on.
  const [following, setFollowing] = useState(true)
  const rootRef = useRef<HTMLDivElement | null>(null)
  // What the person typed (instant); the store searches 250 ms after the last keystroke.
  const [queryText, setQueryText] = useState(searchQuery)
  const [withTimestamps, setWithTimestamps] = useState(false)

  useEffect(() => {
    if (queryText === searchQuery) return
    const timer = setTimeout(() => void search(queryText), 250)
    return () => clearTimeout(timer)
  }, [queryText, searchQuery, search])
  // The store emptied the search (another book, the transcript was deleted): the box follows.
  useEffect(() => {
    if (searchQuery === '') setQueryText('')
  }, [searchQuery])

  useEffect(() => {
    const scroller = rootRef.current?.closest<HTMLElement>('.app-scroll') ?? null
    if (!scroller) return
    const stopFollowing = (): void => setFollowing(false)
    // Only the person's own scrolling counts: wheel, touch, keys, and dragging the scrollbar (a pointer press on the scroller
    // itself). A scroll the panel makes by itself fires none of these.
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target === scroller) stopFollowing()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) stopFollowing()
    }
    scroller.addEventListener('wheel', stopFollowing, { passive: true })
    scroller.addEventListener('touchmove', stopFollowing, { passive: true })
    scroller.addEventListener('pointerdown', onPointerDown)
    scroller.addEventListener('keydown', onKeyDown)
    return () => {
      scroller.removeEventListener('wheel', stopFollowing)
      scroller.removeEventListener('touchmove', stopFollowing)
      scroller.removeEventListener('pointerdown', onPointerDown)
      scroller.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!following || activePassageId === null) return
    rootRef.current?.querySelector(`[data-passage-id="${activePassageId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [following, activePassageId])

  const playFrom = (passage: { trackId?: string; startMs: number }): void => {
    setFollowing(true)
    seekToPassage(passage)
  }

  const summary = info?.transcript ?? null
  const active = isActiveJob(job)
  const interrupted = summary?.lastError === 'INTERRUPTED'
  const incomplete = !!summary && (summary.status !== 'complete' || (summary.totalMs > 0 && summary.coveredMs < summary.totalMs - 1000))

  const groups = useMemo(() => {
    if (tracks.length === 0) return null
    const order = new Map(tracks.map((t, index) => [t.id, index]))
    const out: Array<{ key: string; index: number; title: string; items: typeof passages }> = []
    for (const passage of passages) {
      const key = passage.trackId ?? ''
      const last = out.at(-1)
      if (last && last.key === key) {
        last.items.push(passage)
        continue
      }
      const index = order.get(key) ?? -1
      out.push({ key, index, title: index >= 0 ? (tracks[index]?.title ?? '') : 'Unknown track', items: [passage] })
    }
    return out
  }, [passages, tracks])

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }
  // Resume starts the SAME scope the interrupted / cancelled / failed job had (covered intervals are skipped); a transcript
  // whose scope is unknown (made before it was recorded) or that is already complete continues with the whole audiobook.
  const resumeScope = (): TranscriptionScope => (summary && summary.status !== 'complete' && summary.scope ? summary.scope : { kind: 'whole' })
  const resume = (): Promise<void> => run(() => start({ scope: resumeScope(), language: summary?.language ?? 'auto', modelId: summary?.modelId ?? 'whisper-tiny' }))
  const restart = (): Promise<void> =>
    run(async () => {
      setConfirm(null)
      await start({ scope: { kind: 'whole' }, language: summary?.language ?? 'auto', modelId: summary?.modelId ?? 'whisper-tiny', replace: true })
    })
  const deleteAll = (): Promise<void> =>
    run(async () => {
      setConfirm(null)
      await remove()
    })

  const trackLine = (): string | null => {
    if (!job || job.trackId === undefined) return null
    const index = tracks.findIndex((t) => t.id === job.trackId)
    const name = index >= 0 ? `Track ${index + 1} of ${tracks.length} · ${tracks[index]?.title ?? ''}` : 'Current track'
    return name
  }

  let body
  if (infoStatus === 'idle' || infoStatus === 'loading') {
    body = <p className={EMPTY}>Loading…</p>
  } else if (infoStatus === 'unavailable') {
    body = (
      <div className="flex flex-col gap-2">
        <p className={EMPTY}>The transcript could not be read right now.</p>
        <div>
          <button type="button" className={GHOST_BTN} onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      </div>
    )
  } else if (active && job) {
    const queued = job.state === 'queued'
    body = (
      <div className="flex flex-col gap-3" data-transcript-job>
        <p className="m-0 text-sm text-lib-text" role="status">
          {queued ? 'Waiting for another transcription to finish…' : job.state === 'preparing' ? 'Preparing…' : 'Transcribing…'}
        </p>
        {!queued ? <ProgressBar label="Whole audiobook" done={job.doneMs} total={job.totalMs} /> : null}
        {!queued && trackLine() ? <ProgressBar label={trackLine() as string} done={job.trackDoneMs ?? 0} total={job.trackTotalMs ?? 0} /> : null}
        <div>
          <button type="button" className={GHOST_BTN} onClick={() => void cancel()}>
            Cancel
          </button>
        </div>
      </div>
    )
  } else if (!summary) {
    body = (
      <div className="flex flex-col gap-3">
        <p className={EMPTY}>This audiobook has no transcript yet. Transcribing turns the speech into searchable text, on this device.</p>
        <div>
          <button type="button" className={PRIMARY_BTN} onClick={openDialog}>
            Transcribe
          </button>
        </div>
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-3" data-transcript-summary>
        <div className="flex flex-wrap items-center gap-2">
          {interrupted ? (
            <span className={PILL}>Interrupted</span>
          ) : summary.status === 'cancelled' ? (
            <span className={PILL}>Cancelled</span>
          ) : summary.status === 'failed' ? (
            <span className={PILL}>Failed</span>
          ) : summary.status === 'complete' && !incomplete ? (
            <span className={PILL}>Complete</span>
          ) : null}
          {incomplete && summary.status !== 'failed' ? <span className={PILL} data-transcript-partial>Partial</span> : null}
          {summary.totalMs > 0 ? <span className="text-[12px] text-lib-muted tabular-nums">{percent(summary.coveredMs, summary.totalMs)}% transcribed</span> : null}
        </div>
        {summary.lastError === 'NO_SPEECH' ? <p className={EMPTY}>{transcriptionErrorText('NO_SPEECH')}</p> : null}
        {summary.lastError && summary.lastError !== 'NO_SPEECH' ? <p className="m-0 text-sm leading-relaxed text-lib-muted">{transcriptionErrorText(summary.lastError)}</p> : null}
        {confirm === null ? (
          <div className="flex flex-wrap gap-2">
            {interrupted ? (
              <>
                <button type="button" className={PRIMARY_BTN} disabled={busy} onClick={() => void resume()}>
                  Resume
                </button>
                <button type="button" className={GHOST_BTN} disabled={busy} onClick={() => setConfirm('restart')}>
                  Restart
                </button>
              </>
            ) : incomplete ? (
              <button type="button" className={PRIMARY_BTN} disabled={busy} onClick={() => void resume()}>
                {summary.status === 'failed' ? 'Try again' : 'Continue'}
              </button>
            ) : null}
            {!interrupted ? (
              <button type="button" className={GHOST_BTN} disabled={busy} onClick={openDialog}>
                Transcribe…
              </button>
            ) : null}
            {!interrupted && !incomplete ? (
              <button type="button" className={GHOST_BTN} disabled={busy} onClick={() => setConfirm('restart')}>
                Re-run
              </button>
            ) : null}
            {summary.passageCount > 0 ? (
              <>
                <button type="button" className={GHOST_BTN} disabled={busy || exporting} onClick={() => void exportTranscript({ timestamps: withTimestamps })}>
                  {exporting ? 'Exporting…' : 'Export…'}
                </button>
                <label className="flex items-center gap-1.5 text-[12px] text-lib-muted">
                  <input type="checkbox" checked={withTimestamps} onChange={(event) => setWithTimestamps(event.target.checked)} disabled={exporting} />
                  Include timestamps
                </label>
              </>
            ) : null}
            <button type="button" className={`${GHOST_BTN} hover:!text-rose-300`} disabled={busy} onClick={() => setConfirm('delete')}>
              Delete
            </button>
          </div>
        ) : confirm === 'delete' ? (
          <ConfirmBox message="Delete this transcript?" confirmLabel="Delete" onConfirm={() => void deleteAll()} onCancel={() => setConfirm(null)} />
        ) : (
          <ConfirmBox
            message="Transcribe again and replace the current text?"
            confirmLabel="Replace"
            onConfirm={() => void restart()}
            onCancel={() => setConfirm(null)}
          />
        )}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-3" data-transcript-panel>
      {body}
      {actionError ? (
        <p role="alert" className="m-0 text-[13px] leading-relaxed text-rose-300">
          {transcriptionErrorText(actionError.code, actionError.message)}
        </p>
      ) : null}
      {passagesStatus === 'unavailable' ? (
        <p role="status" className="m-0 text-[12px] text-lib-muted">
          The text could not be refreshed just now; what is shown may be out of date.
        </p>
      ) : null}
      {exportSaved ? (
        <p role="status" className="m-0 text-[12px] text-lib-muted">
          Transcript saved.
        </p>
      ) : null}
      {summary && summary.passageCount > 0 ? (
        <div className="flex flex-col gap-2" data-transcript-search>
          <div className="flex items-center gap-1.5">
            <input
              type="search"
              aria-label="Search the transcript"
              placeholder="Search the transcript"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && queryText) {
                  setQueryText('')
                  clearSearch()
                }
              }}
              className="h-8 min-w-0 flex-1 rounded-lg border border-lib-border bg-lib-input px-2.5 text-sm text-lib-text outline-none focus:border-lib-accent-ring"
            />
            {queryText ? (
              <button
                type="button"
                className={GHOST_BTN}
                aria-label="Clear search"
                onClick={() => {
                  setQueryText('')
                  clearSearch()
                }}
              >
                ✕
              </button>
            ) : null}
          </div>
          {searchStatus === 'searching' ? (
            <p role="status" className={EMPTY}>
              Searching…
            </p>
          ) : null}
          {searchStatus === 'unavailable' ? (
            <p role="status" className={EMPTY}>
              The search could not run just now.
            </p>
          ) : null}
          {searchStatus === 'ready' && searchHits.length === 0 ? (
            <p role="status" className={EMPTY}>
              No matches.
            </p>
          ) : null}
          {searchHits.length > 0 ? (
            <ul aria-label="Search results" className="m-0 flex list-none flex-col gap-1 p-0">
              {searchHits.map((hit) => {
                const trackIndex = hit.trackId ? tracks.findIndex((t) => t.id === hit.trackId) : -1
                return (
                  <li key={hit.passageId}>
                    <button
                      type="button"
                      data-search-hit
                      aria-label={`Play from ${formatPassageTime(hit.startMs)}: ${hit.snippet}`}
                      className="flex w-full cursor-pointer flex-col gap-0.5 rounded-md border border-lib-border-soft bg-lib-surface px-2 py-1.5 text-left text-sm leading-snug text-lib-text transition-colors hover:bg-lib-surface-hover"
                      onClick={() => playFrom(hit)}
                    >
                      <span className="text-[11px] tabular-nums text-lib-faint">
                        {trackIndex >= 0 ? `Track ${trackIndex + 1} · ` : ''}
                        {formatPassageTime(hit.startMs)}
                      </span>
                      <span className="min-w-0 break-words">{hit.snippet}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
          {searchHits.length >= SEARCH_HIT_LIMIT ? <p className={EMPTY}>Showing the first {SEARCH_HIT_LIMIT} matches. Narrow the search to see others.</p> : null}
        </div>
      ) : null}
      {passages.length > 0 && !following && activePassageId !== null ? (
        <div className="sticky top-0 z-10 flex justify-end">
          <button type="button" data-transcript-follow className={`${PRIMARY_BTN} shadow-md`} onClick={() => setFollowing(true)}>
            Follow
          </button>
        </div>
      ) : null}
      {passages.length > 0 ? (
        <div className="flex flex-col gap-2" aria-label="Transcript">
          {groups
            ? groups.map((group, g) => (
                <section key={`${group.key}-${g}`} className="flex flex-col gap-1">
                  <h3 className="m-0 px-1 pt-2 text-[11px] font-bold tracking-wide text-lib-faint uppercase">
                    {group.index >= 0 ? `Track ${group.index + 1} · ` : ''}
                    {group.title}
                  </h3>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {group.items.map((p) => (
                      <PassageRow key={p.id} id={p.id} startMs={p.startMs} text={p.text} active={p.id === activePassageId} onPlay={() => playFrom(p)} />
                    ))}
                  </ul>
                </section>
              ))
            : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {passages.map((p) => (
                  <PassageRow key={p.id} id={p.id} startMs={p.startMs} text={p.text} active={p.id === activePassageId} onPlay={() => playFrom(p)} />
                ))}
              </ul>
            )}
          {truncated ? <LoadMoreRow shown={passages.length} onLoad={() => void loadMore()} /> : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The end of a long transcript's first pages: scrolling it into view reads the next page (where the browser supports
 * IntersectionObserver); the button does the same by hand.
 */
function LoadMoreRow({ shown, onLoad }: { shown: number; onLoad: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoad()
      },
      { rootMargin: '200px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [onLoad, shown])
  return (
    <div ref={ref} data-transcript-more className="flex flex-col items-start gap-2 px-1 py-2">
      <p className={EMPTY}>Showing the first {shown} passages.</p>
      <button type="button" className={GHOST_BTN} onClick={onLoad}>
        Show more
      </button>
    </div>
  )
}

/**
 * One passage: a button, so it works with the keyboard too. Pressing it plays from this passage (same rules as a Note jump);
 * the passage being spoken is highlighted and marked `aria-current`.
 */
function PassageRow({ id, startMs, text, active, onPlay }: { id: number; startMs: number; text: string; active: boolean; onPlay: () => void }) {
  return (
    <li data-passage data-passage-id={id} data-active={active ? 'true' : undefined}>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        aria-label={`Play from ${formatPassageTime(startMs)}: ${text}`}
        className={`flex w-full cursor-pointer gap-2 rounded-md border px-1.5 py-1 text-left text-sm leading-snug transition-colors ${
          active ? 'border-lib-accent bg-lib-accent-soft text-lib-text-strong' : 'border-transparent bg-transparent text-lib-text hover:bg-lib-surface-hover'
        }`}
        onClick={onPlay}
      >
        <span className="w-12 shrink-0 text-[11px] tabular-nums text-lib-faint">{formatPassageTime(startMs)}</span>
        <span className="min-w-0 break-words">{text}</span>
      </button>
    </li>
  )
}
