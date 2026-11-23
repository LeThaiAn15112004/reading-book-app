import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { chapterIndexAt } from '@core'
import { miniPlayerApi } from '../../bridge'
import { useT } from '../../i18n'
import { isFeatureAvailable } from '../../platforms/host'
import { endAudioSession, selectCanChangeChapter, useAudioPlayerStore } from '../../screens/AudioBook/logic/audioPlayerStore'
import { MINI_PLAYER_BAR_HEIGHT_PX, useMiniPlayerUiStore } from '../../screens/AudioBook/logic/miniPlayerUiStore'
import { currentSkipLengths } from '../../screens/AudioBook/logic/skipLengths'
import { CloseIcon, PauseIcon, PlayIcon, PopOutIcon, SkipBackIcon, SkipForwardIcon, WarningIcon } from './AudioIcons'

const ICON_BUTTON =
  'focus-ring inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-lib-text hover:bg-lib-surface-hover hover:text-lib-text-strong disabled:cursor-not-allowed disabled:opacity-40'
const WARNING_BUTTON =
  'focus-ring inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg border border-lib-warning-border bg-transparent px-2.5 text-xs font-medium text-lib-warning-text hover:bg-lib-warning-bg'

/** Route of the player of `bookId`. */
function playerPath(bookId: string): string {
  return `/reader/${encodeURIComponent(bookId)}`
}

/**
 * Spec 018 US5 (FR-020, FR-024, contracts/player-ui.md): the in-app mini player — shown on every screen of the main
 * window while a listening session is active and its full player is not on screen (and the floating window is not
 * open). Reads and drives the ONE `audioPlayerStore`; owns no playback state. In the text reader it sits just above the
 * reader's footer (the reader keeps its text clear of it), elsewhere at the bottom of the content area.
 */
export function MiniPlayerBar() {
  const t = useT()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const bookId = useAudioPlayerStore((s) => s.bookId)
  const status = useAudioPlayerStore((s) => s.status)
  const title = useAudioPlayerStore((s) => s.title)
  const coverUrl = useAudioPlayerStore((s) => s.coverUrl)
  const playing = useAudioPlayerStore((s) => s.playing)
  const position = useAudioPlayerStore((s) => s.positionSeconds)
  const duration = useAudioPlayerStore((s) => s.durationSeconds)
  const subtitle = useAudioPlayerStore((s) => {
    const track = s.tracks[s.trackIndex]
    if (track) return track.title
    if (s.chapterStatus !== 'ok') return null
    return s.chapters[chapterIndexAt(s.chapters, s.positionSeconds)]?.title ?? null
  })
  const failed = useAudioPlayerStore((s) => {
    const track = s.tracks[s.trackIndex]
    return track !== undefined && s.trackErrors.has(track.id)
  })
  const canNext = useAudioPlayerStore((s) => selectCanChangeChapter(s, 1))
  const windowOpen = useMiniPlayerUiStore((s) => s.windowOpen)
  const readerBottomOffset = useMiniPlayerUiStore((s) => s.readerBottomOffset)
  const setBarVisible = useMiniPlayerUiStore((s) => s.setBarVisible)

  const onItsPlayer = bookId !== null && pathname === playerPath(bookId)
  const visible =
    isFeatureAvailable('miniPlayer') && bookId !== null && status === 'ready' && !onItsPlayer && !windowOpen

  useEffect(() => {
    setBarVisible(visible)
  }, [visible, setBarVisible])
  useEffect(() => () => setBarVisible(false), [setBarVisible])

  if (!visible || bookId === null) return null
  const skip = currentSkipLengths()
  const store = useAudioPlayerStore.getState
  const fraction = duration && duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0
  // On a text reader route the reader tells where its footer ends; elsewhere the bar is at the very bottom.
  const bottom = pathname.startsWith('/reader/') && readerBottomOffset !== null ? readerBottomOffset : 0

  return (
    <section
      data-mini-player-bar=""
      aria-label={t('chrome.miniPlayer.region')}
      className="absolute inset-x-0 z-[95] flex items-center gap-2 border-t border-lib-border-soft bg-lib-surface-strong px-3 backdrop-blur-md"
      style={{ height: MINI_PLAYER_BAR_HEIGHT_PX, bottom }}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-lib-border-soft" aria-hidden>
        <span className="block h-full bg-lib-accent" style={{ width: `${fraction * 100}%` }} />
      </span>

      <button
        type="button"
        className="focus-ring flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg border-none bg-transparent p-1 text-left hover:bg-lib-surface-hover"
        aria-label={t('chrome.miniPlayer.openPlayer', { title })}
        title={t('chrome.miniPlayer.openPlayer', { title })}
        onClick={() => navigate(playerPath(bookId))}
      >
        {coverUrl ? (
          <img src={coverUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="size-10 shrink-0 rounded-md bg-lib-bg-mid" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-lib-text-strong">{title}</span>
          {failed ? (
            <span className="flex items-center gap-1 truncate text-xs text-lib-warning-text">
              <WarningIcon className="size-3.5 shrink-0" />
              {t('chrome.miniPlayer.trackFailed')}
            </span>
          ) : subtitle ? (
            <span className="block truncate text-xs text-lib-muted">{subtitle}</span>
          ) : null}
        </span>
      </button>

      {failed ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" className={WARNING_BUTTON} onClick={() => store().goToTrack(store().trackIndex)}>
            {t('chrome.miniPlayer.tryAgain')}
          </button>
          {canNext ? (
            <button type="button" className={WARNING_BUTTON} onClick={() => store().nextChapter()}>
              {t('chrome.miniPlayer.skipNext')}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label={t('chrome.miniPlayer.skipBack', { seconds: skip.back })}
            title={t('chrome.miniPlayer.skipBack', { seconds: skip.back })}
            onClick={() => store().skipBy(-skip.back)}
          >
            <SkipBackIcon seconds={skip.back} className="size-6" />
          </button>
          <button
            type="button"
            className="focus-ring inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-lib-accent text-lib-on-accent hover:bg-lib-accent-hover"
            aria-label={playing ? t('chrome.miniPlayer.pause') : t('chrome.miniPlayer.play')}
            title={playing ? t('chrome.miniPlayer.pause') : t('chrome.miniPlayer.play')}
            onClick={() => store().toggle()}
          >
            {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label={t('chrome.miniPlayer.skipForward', { seconds: skip.forward })}
            title={t('chrome.miniPlayer.skipForward', { seconds: skip.forward })}
            onClick={() => store().skipBy(skip.forward)}
          >
            <SkipForwardIcon seconds={skip.forward} className="size-6" />
          </button>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1 border-l border-lib-border-soft pl-2">
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={t('chrome.miniPlayer.popOut')}
          title={t('chrome.miniPlayer.popOutTitle')}
          onClick={() => void miniPlayerApi.open()}
        >
          <PopOutIcon />
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={t('chrome.miniPlayer.close')}
          title={t('chrome.miniPlayer.close')}
          onClick={() => void endAudioSession()}
        >
          <CloseIcon />
        </button>
      </div>
    </section>
  )
}
