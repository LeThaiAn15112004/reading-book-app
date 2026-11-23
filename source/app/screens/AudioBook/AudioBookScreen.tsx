import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { features } from '@core/config'
import { appApi } from '../../bridge'
import { chapterIndexAt, timelineView, trackEyebrow } from '@core'
import { useOpenReading } from '../../components/chrome'
import { BookCover } from '../Library/components/book'
import { ReaderOpeningScreen } from '../../components/reader/ReaderOpeningScreen'
import { SidebarEdgeRail, useSidebarPanelResize, type SidebarTab } from '../Reader/components/sidebar'
import { SIDEBAR_TABS, sidebarContentInsetLeft } from '../Reader/components/sidebar/sidebarTabs'
import { useBookRelinkStore } from '../Reader/logic/bookRelink/bookRelinkStore'
import { AudioControls } from './components/AudioControls'
import { AudioNoteMenu } from './components/AudioNoteMenu'
import { AudioSidebarPanel } from './components/AudioSidebar'
import { AudioTimeline, ProgressScopeSelector } from './components/AudioTimeline'
import { useAudioPlayerStore } from './logic/audioPlayerStore'
import { useAudioPlayerShortcuts } from './logic/useAudioPlayerShortcuts'
import { isActiveJob, useTranscriptStore } from './logic/transcriptStore'
import { TranscribeDialog } from './components/TranscribeDialog'
import { resolveAppLanguage } from '../../theme/appAppearance'
import { useAppAppearanceStore } from '../../theme/appAppearanceStore'
import { getT, uiText, useT, useUiLanguage } from '../../i18n'

const SIDEBAR_OPEN_KEY = 'readmate.audioSidebarOpen.v1'
/** The text reader's rail, minus Page layout (no pages) and Bookmark (audio's marked positions are its Notes). */
const AUDIO_SIDEBAR_TABS_ALL = SIDEBAR_TABS.filter((t) => t.id !== 'layout' && t.id !== 'bookmarks')
/**
 * Without the Transcript tab: the rail while `features.audiobookTranscriptionEnabled` is off (it stays off until the own-build
 * FFmpeg decoder is integrated and verified — spec 004, task T033).
 */
const AUDIO_SIDEBAR_TABS_NO_TRANSCRIPT = AUDIO_SIDEBAR_TABS_ALL.filter((t) => t.id !== 'transcript')

/** Leading symbol of the player's warning notices (spec 018 FR-001): decorative, the text says what happened. */
function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 9v3.75m0 3.75h.008v.008H12v-.008Z" />
      <path d="M10.34 3.94 2.6 17.25A1.95 1.95 0 0 0 4.27 20.2h15.46a1.95 1.95 0 0 0 1.67-2.95L13.66 3.94a1.92 1.92 0 0 0-3.32 0Z" />
    </svg>
  )
}

/** Buttons inside a warning notice: theme warning colours (readable in Night, Sepia and Paper). */
const WARNING_BUTTON =
  'focus-ring inline-flex h-8 cursor-pointer items-center rounded-lg border border-lib-warning-border bg-transparent px-3 text-[13px] font-medium text-lib-warning-text hover:bg-lib-warning-bg'

function readOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * "Transcribe" (spec 004, FR-001): the entry point next to the player. It opens the transcript tab and the dialog; while a
 * job is queued or running it only says so (the panel has the progress and Cancel).
 */
function TranscribeEntry({ onOpen }: { onOpen: () => void }) {
  const t = useT()
  const job = useTranscriptStore((s) => s.job)
  const hasTranscript = useTranscriptStore((s) => s.info?.transcript != null)
  const openDialog = useTranscriptStore((s) => s.openDialog)
  const running = isActiveJob(job)
  return (
    <button
      type="button"
      data-transcribe-entry
      className="focus-ring inline-flex h-8 cursor-pointer items-center rounded-full border border-lib-border bg-transparent px-3.5 text-[13px] font-medium text-lib-muted transition-colors hover:text-lib-text-strong"
      onClick={() => {
        onOpen()
        if (!running && !hasTranscript) openDialog()
      }}
    >
      {running ? t('audiobook.player.screen.transcribing') : hasTranscript ? t('audiobook.player.screen.transcript') : t('audiobook.player.screen.transcribe')}
    </button>
  )
}

/** "4h 11m left" / "12m left" / "under a minute left". */
function formatLeft(seconds: number): string {
  const m = Math.round(seconds / 60)
  const t = getT()
  if (seconds <= 0) return t('audiobook.player.screen.finished')
  if (m < 1) return t('audiobook.player.screen.underMinute')
  const h = Math.floor(m / 60)
  return h > 0
    ? t('audiobook.player.screen.leftHours', { hours: h, minutes: String(m % 60).padStart(2, '0') })
    : t('audiobook.player.screen.leftMinutes', { minutes: m })
}

/**
 * Title block: the current chapter (when the file has validated chapters) above the audiobook's title and author.
 * A multi-track audiobook shows "Track N of M" and the current TRACK's title as the heading, with the audiobook's title and
 * author as the secondary line.
 */
function NowPlaying() {
  const t = useT()
  const language = useUiLanguage()
  const title = useAudioPlayerStore((s) => s.title)
  const author = useAudioPlayerStore((s) => s.author)
  const tracks = useAudioPlayerStore((s) => s.tracks)
  const trackIndex = useAudioPlayerStore((s) => s.trackIndex)
  const chapters = useAudioPlayerStore((s) => s.chapters)
  const status = useAudioPlayerStore((s) => s.chapterStatus)
  const index = useAudioPlayerStore((s) => chapterIndexAt(s.chapters, s.positionSeconds))
  const chapter = status === 'ok' && index >= 0 ? chapters[index] : undefined
  const track = tracks[trackIndex]
  if (track) {
    const eyebrow = trackEyebrow(trackIndex, tracks.length, language)
    return (
      <div className="flex flex-col gap-1.5">
        {eyebrow ? <div className="text-xs font-semibold tracking-[0.08em] text-lib-accent uppercase">{eyebrow}</div> : null}
        <h1 className="m-0 text-2xl leading-tight font-bold text-lib-text-strong">{track.title}</h1>
        <p className="m-0 text-sm text-lib-muted">{[title, author].filter(Boolean).join(' · ')}</p>
      </div>
    )
  }
  const meta = [chapter ? title : null, author].filter(Boolean).join(' · ')
  return (
    <div className="flex flex-col gap-1.5">
      {chapter ? (
        <div className="text-xs font-semibold tracking-[0.08em] text-lib-accent uppercase">
          {t('audiobook.player.screen.chapterOf', { current: index + 1, total: chapters.length })}
        </div>
      ) : null}
      <h1 className="m-0 text-2xl leading-tight font-bold text-lib-text-strong">{chapter ? chapter.title : title}</h1>
      {meta ? <p className="m-0 text-sm text-lib-muted">{meta}</p> : null}
    </div>
  )
}

/**
 * Multi-track audiobooks: the current track could not be played. The player stays on screen (this is not the screen-level
 * error); the user can try it again, skip to the next track, or pick any other track in Contents.
 */
function TrackErrorNotice() {
  const t = useT()
  const trackIndex = useAudioPlayerStore((s) => s.trackIndex)
  const track = useAudioPlayerStore((s) => s.tracks[s.trackIndex])
  const failed = useAudioPlayerStore((s) => {
    const t = s.tracks[s.trackIndex]
    return t !== undefined && s.trackErrors.has(t.id)
  })
  const hasNext = useAudioPlayerStore((s) => s.tracks.length > 0 && s.trackIndex < s.tracks.length - 1)
  const goToTrack = useAudioPlayerStore((s) => s.goToTrack)
  const nextChapter = useAudioPlayerStore((s) => s.nextChapter)
  if (!failed || !track) return null
  const button = WARNING_BUTTON
  return (
    <div
      role="alert"
      className="flex w-full flex-col items-center gap-2 rounded-lg border border-lib-warning-border bg-lib-warning-bg px-4 py-3 text-center text-sm text-lib-warning-text"
    >
      <p className="m-0 inline-flex items-center gap-2">
        <WarningIcon />
        {t('audiobook.player.screen.trackFailed', { title: track.title })}
      </p>
      <div className="flex gap-2">
        <button type="button" className={button} onClick={() => goToTrack(trackIndex)}>
          {t('audiobook.player.screen.tryAgain')}
        </button>
        {hasNext ? (
          <button type="button" className={button} onClick={nextChapter}>
            {t('audiobook.player.screen.skipNext')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * A message about the last Note action: the limit was reached, a save was refused (the list was reloaded), or a Note jump could
 * not play its track (the player is back on the track it was on). It never replaces the player or the Notes view.
 */
function NoteNotice() {
  const t = useT()
  const notice = useAudioPlayerStore((s) => s.noteNotice)
  const dismiss = useAudioPlayerStore((s) => s.dismissNoteNotice)
  if (!notice) return null
  return (
    <div
      role="status"
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-lib-warning-border bg-lib-warning-bg px-4 py-2 text-sm text-lib-warning-text"
    >
      <span className="inline-flex items-center gap-2">
        <WarningIcon />
        {uiText(t, notice)}
      </span>
      <button
        type="button"
        className={WARNING_BUTTON}
        onClick={dismiss}
      >
        {t('audiobook.player.screen.dismiss')}
      </button>
    </div>
  )
}

/** Whole-book progress, always shown (independent of the timeline scope). */
function BookProgress() {
  const t = useT()
  const position = useAudioPlayerStore((s) => s.positionSeconds)
  const duration = useAudioPlayerStore((s) => s.durationSeconds)
  // A multi-track audiobook has no whole-book progress here: position and duration are those of one track.
  const multiTrack = useAudioPlayerStore((s) => s.tracks.length > 0)
  const view = useMemo(() => timelineView('book', position, duration, []), [position, duration])
  if (multiTrack || !view) return null
  const pct = Math.round(view.fraction * 100)
  return (
    <div className="mt-3 flex items-center gap-3">
      <div className="h-1 flex-1 overflow-hidden rounded-sm bg-lib-border" aria-hidden>
        <div className="h-full bg-lib-faint" style={{ width: `${view.fraction * 100}%` }} />
      </div>
      <span className="text-xs whitespace-nowrap text-lib-muted">
        {t('audiobook.player.screen.progress', { percent: pct, left: formatLeft(view.remainingSeconds) })}
      </span>
    </div>
  )
}

/**
 * Audiobook player (MP3). Mounted by `ReaderRoute` instead of `ReaderScreen` for audio books.
 * The left side is the text reader's own sidebar chrome (`SidebarEdgeRail` icon rail + a resizable
 * panel, same width preference); the player sits to its right and gives way as the panel opens.
 * Leaving to the Library is done from the menu bar, which also flushes the progress.
 */
export function AudioBookScreen({ bookId }: { bookId: string }) {
  const t = useT()
  const { ensureTab, updateBookTitle } = useOpenReading()
  const navigate = useNavigate()
  const status = useAudioPlayerStore((s) => s.status)
  const title = useAudioPlayerStore((s) => s.title)
  const coverUrl = useAudioPlayerStore((s) => s.coverUrl)
  const errorMessage = useAudioPlayerStore((s) => s.errorMessage)
  const errorCode = useAudioPlayerStore((s) => s.errorCode)
  const load = useAudioPlayerStore((s) => s.load)
  const dispose = useAudioPlayerStore((s) => s.dispose)
  const relink = useBookRelinkStore()
  const sidebarResize = useSidebarPanelResize('left')
  const multiTrack = useAudioPlayerStore((s) => s.tracks.length > 0)
  const bindTranscript = useTranscriptStore((s) => s.bind)
  const unbindTranscript = useTranscriptStore((s) => s.unbind)
  const appLanguage = resolveAppLanguage(useAppAppearanceStore((s) => s.language))

  const [open, setOpenState] = useState(readOpen)
  const [tab, setTab] = useState<SidebarTab>('chapters')
  // Multi-track audiobooks have the same rail as single-file ones, Notes included.
  // FR-017: also needs a decoder that ships for this OS + CPU; hidden until Main has said so.
  const [platformSupported, setPlatformSupported] = useState(false)
  useEffect(() => {
    let alive = true
    appApi.getAppInfo().then(
      (info) => alive && setPlatformSupported(info.transcriptionSupported),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])
  const transcriptionEnabled = features.audiobookTranscriptionEnabled && platformSupported
  const railTabs = transcriptionEnabled ? AUDIO_SIDEBAR_TABS_ALL : AUDIO_SIDEBAR_TABS_NO_TRANSCRIPT
  const activeTab: SidebarTab = tab
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    try {
      localStorage.setItem(SIDEBAR_OPEN_KEY, next ? '1' : '0')
    } catch {
      // The open / closed state is only a convenience.
    }
  }, [])

  useEffect(() => {
    ensureTab(bookId)
    void load(bookId)
    return () => {
      void dispose()
    }
  }, [bookId, ensureTab, load, dispose])

  // Follow this audiobook's transcript for as long as the screen is open (progress keeps arriving while the tab is closed).
  // While transcription is switched off nothing follows it: no subscription, no IPC call.
  useEffect(() => {
    if (!transcriptionEnabled) return
    bindTranscript(bookId, appLanguage)
    return () => unbindTranscript()
  }, [transcriptionEnabled, bookId, appLanguage, bindTranscript, unbindTranscript])

  useEffect(() => {
    if (status === 'ready' && title) updateBookTitle(bookId, title)
  }, [bookId, status, title, updateBookTitle])

  // Spec 018 US2: Space / ← / → / ⇧← / ⇧→ / ↑ / ↓ / M / [ / ] / B — listed and rebindable in Settings → Keyboard Shortcuts.
  useAudioPlayerShortcuts()

  const leave = useCallback(async () => {
    await dispose()
    navigate('/library')
  }, [dispose, navigate])
  const retry = useCallback(() => void load(bookId), [load, bookId])

  // Spec 017 (US2): the preflight wait and its error use the one opening screen (the player itself is unchanged).
  if (status === 'idle' || status === 'loading' || status === 'error') {
    const isError = status === 'error'
    return (
      <div className="relative flex h-full min-h-0 flex-1 text-lib-text" data-audio-screen>
        <ReaderOpeningScreen
          visible
          status={isError ? 'error' : 'loading'}
          bookId={bookId}
          title={title}
          coverUrl={coverUrl}
          message={isError && errorMessage ? uiText(t, errorMessage) : null}
          onRetry={retry}
          onBack={() => void leave()}
          onLocate={
            isError && errorCode === 'missing_file'
              ? () => {
                  void relink.locate(bookId).then((linked) => {
                    if (linked) retry()
                  })
                }
              : undefined
          }
          locating={relink.locating}
          locateMessage={relink.notice?.bookId === bookId ? uiText(t, relink.notice.text) : null}
        />
      </div>
    )
  }

  return (
    // `h-full`: the app frame is a plain block, so `flex-1` alone left this screen as tall as its content and the sidebar
    // (absolute, inset-y-0) stopped short of the window's bottom edge.
    <div className="relative flex h-full min-h-0 flex-1 text-lib-text" data-audio-screen>
      <SidebarEdgeRail
        open={open}
        activeTab={activeTab}
        tabs={railTabs}
        panelWidth={sidebarResize.panelWidth}
        isResizing={sidebarResize.isResizing}
        chromeHidden
        bottomInsetPx={0}
        onOpenTab={(next) => {
          setTab(next)
          setOpen(true)
        }}
        onToggle={() => setOpen(!open)}
      />
      <AudioSidebarPanel
        bookId={bookId}
        tab={activeTab}
        open={open}
        panelWidth={sidebarResize.panelWidth}
        isResizing={sidebarResize.isResizing}
        onClose={() => setOpen(false)}
        onResizePointerDown={sidebarResize.onResizePointerDown}
      />

      <main
        className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-auto px-6 py-4 ${
          sidebarResize.isResizing ? '' : 'transition-[padding] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'
        }`}
        style={{ paddingLeft: sidebarContentInsetLeft(open, sidebarResize.panelWidth) + 24 }}
      >
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-7 py-4">
          <div className="flex w-full flex-wrap items-center justify-center gap-6">
            <BookCover
              bookId={bookId}
              title={title}
              coverUrl={coverUrl}
              className="h-60 w-[180px] shrink-0 rounded-xl shadow-xl"
              titleClassName="line-clamp-6 text-base leading-snug font-semibold text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]"
            />
            <div className="min-w-60 flex-1">
              <NowPlaying />
              <BookProgress />
            </div>
          </div>

          <div className="flex w-full flex-col gap-3">
            {multiTrack ? null : (
              <div className="flex justify-end">
                <ProgressScopeSelector />
              </div>
            )}
            <AudioTimeline />
          </div>

          <TrackErrorNotice />
          <NoteNotice />
          <AudioControls />
          {transcriptionEnabled ? (
            <TranscribeEntry
              onOpen={() => {
                setTab('transcript')
                setOpen(true)
              }}
            />
          ) : null}
        </div>
      </main>
      <AudioNoteMenu />
      {transcriptionEnabled ? <TranscribeDialog bookId={bookId} /> : null}
    </div>
  )
}
