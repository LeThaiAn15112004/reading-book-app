import { useEffect, useState, type KeyboardEvent } from 'react'
import { create } from 'zustand'
import { formatPlaybackTime } from '@core'
import type { MiniPlayerCommand as MiniPlayerCommandDto, MiniPlayerState } from '../../bridge'
import { miniPlayerWindowHost } from '../../platforms/miniPlayerWindow'
import { useT, useUiLanguageStore } from '../../i18n'
import {
  CloseIcon,
  MinimizeIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  ReturnIcon,
  SkipBackIcon,
  SkipForwardIcon,
  WarningIcon,
} from '../../components/audio/AudioIcons'

/** The last state Main relayed (spec 018: the floating window is a remote control, it owns no playback). */
const useFloatingStateStore = create<{ state: MiniPlayerState; set: (state: MiniPlayerState) => void }>(
  (set) => ({ state: null, set: (state) => set({ state }) }),
)

const ICON_BUTTON =
  'focus-ring inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-lib-text hover:bg-lib-surface-hover hover:text-lib-text-strong disabled:cursor-not-allowed disabled:opacity-40 [-webkit-app-region:no-drag]'
const WARNING_BUTTON =
  'focus-ring inline-flex h-7 cursor-pointer items-center rounded-lg border border-lib-warning-border bg-transparent px-2 text-xs font-medium text-lib-warning-text hover:bg-lib-warning-bg [-webkit-app-region:no-drag]'

function send(command: MiniPlayerCommandDto): void {
  miniPlayerWindowHost.command(command)
}

/**
 * Spec 018 US5 (FR-021, contracts/player-ui.md): the floating always-on-top window's content. Theme and language come
 * with the state (it has no stores of its own to follow); every button sends a command that the main window's player
 * runs. Draggable body, controls excluded from the drag region.
 */
export function MiniPlayerWindow() {
  const t = useT()
  const state = useFloatingStateStore((s) => s.state)
  const [dragValue, setDragValue] = useState<number | null>(null)

  useEffect(() => miniPlayerWindowHost.onState((next) => useFloatingStateStore.getState().set(next)), [])
  useEffect(() => {
    if (!state) return
    document.documentElement.dataset.theme = state.theme
    if (useUiLanguageStore.getState().language !== state.uiLanguage) useUiLanguageStore.setState({ language: state.uiLanguage })
  }, [state])
  useEffect(() => {
    document.title = t('chrome.miniPlayer.windowTitle')
  }, [t])

  if (!state) return <div className="h-screen w-screen bg-lib-bg-deep [-webkit-app-region:drag]" aria-busy="true" />

  const failed = state.status === 'trackFailed'
  const openFullPlayer = () => {
    send({ type: 'openPlayer' })
    miniPlayerWindowHost.returnToApp()
  }
  const duration = state.durationSeconds
  const shown = dragValue ?? state.positionSeconds
  const commitSeek = () => {
    if (dragValue !== null) send({ type: 'seek', positionSeconds: dragValue })
    setDragValue(null)
  }
  // Space / ← / → while the window is focused (a focused button / the slider keep their own keys).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') return
    if (event.code === 'Space') send({ type: 'toggle' })
    else if (event.key === 'ArrowLeft') send({ type: 'skipBack' })
    else if (event.key === 'ArrowRight') send({ type: 'skipForward' })
    else return
    event.preventDefault()
  }

  return (
    <div
      className="flex h-screen w-screen flex-col gap-1.5 overflow-hidden border border-lib-border bg-lib-bg-deep px-3 pt-2.5 pb-2 text-lib-text select-none [-webkit-app-region:drag]"
      role="region"
      aria-label={t('chrome.miniPlayer.region')}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {/* Double-click the book (cover / title) to open the full player in the main window. Not a drag region: a
            drag region swallows the double-click. */}
        <div
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 [-webkit-app-region:no-drag]"
          title={t('chrome.miniPlayer.openPlayerHint', { title: state.title })}
          onDoubleClick={openFullPlayer}
        >
        {state.coverUrl ? (
          <img src={state.coverUrl} alt="" className="size-11 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="size-11 shrink-0 rounded-md bg-lib-bg-mid" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-sm font-semibold text-lib-text-strong" title={state.title}>
            {state.title}
          </p>
          {failed ? (
            <p className="m-0 flex items-center gap-1 truncate text-xs text-lib-warning-text">
              <WarningIcon className="size-3.5 shrink-0" />
              {t('chrome.miniPlayer.trackFailed')}
            </p>
          ) : state.subtitle ? (
            <p className="m-0 truncate text-xs text-lib-muted" title={state.subtitle}>
              {state.subtitle}
            </p>
          ) : null}
        </div>
        </div>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={t('chrome.miniPlayer.minimize')}
          title={t('chrome.miniPlayer.minimize')}
          onClick={() => miniPlayerWindowHost.minimize()}
        >
          <MinimizeIcon />
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={t('chrome.miniPlayer.returnToApp')}
          title={t('chrome.miniPlayer.returnToApp')}
          onClick={() => miniPlayerWindowHost.returnToApp()}
        >
          <ReturnIcon />
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={t('chrome.miniPlayer.closeWindow')}
          title={t('chrome.miniPlayer.closeWindow')}
          onClick={() => miniPlayerWindowHost.close()}
        >
          <CloseIcon />
        </button>
      </div>

      {failed ? (
        <div className="flex items-center gap-1.5">
          <button type="button" className={WARNING_BUTTON} onClick={() => send({ type: 'retryTrack' })}>
            {t('chrome.miniPlayer.tryAgain')}
          </button>
          {state.canNext ? (
            <button type="button" className={WARNING_BUTTON} onClick={() => send({ type: 'next' })}>
              {t('chrome.miniPlayer.skipNext')}
            </button>
          ) : null}
          <button type="button" className={WARNING_BUTTON} onClick={() => send({ type: 'openPlayer' })}>
            {t('chrome.miniPlayer.openPlayer', { title: state.title })}
          </button>
        </div>
      ) : (
        <>
          <input
            type="range"
            aria-label={t('chrome.miniPlayer.seek')}
            aria-valuetext={duration ? `${formatPlaybackTime(shown)} / ${formatPlaybackTime(duration)}` : formatPlaybackTime(shown)}
            className="focus-ring h-1.5 w-full cursor-pointer rounded accent-[var(--lib-accent,currentColor)] [-webkit-app-region:no-drag]"
            min={0}
            max={duration ?? 0}
            step={1}
            disabled={!duration}
            value={Math.min(shown, duration ?? 0)}
            onChange={(e) => setDragValue(Number(e.target.value))}
            onPointerUp={commitSeek}
            onKeyUp={commitSeek}
            onBlur={commitSeek}
          />
          <div className="flex items-center justify-between">
            <span className="w-12 text-[12px] tabular-nums text-lib-muted">{formatPlaybackTime(shown)}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={ICON_BUTTON}
                disabled={!state.canPrevious}
                aria-label={t('audiobook.player.controls.previousChapter')}
                title={t('audiobook.player.controls.previousChapter')}
                onClick={() => send({ type: 'previous' })}
              >
                <PreviousIcon className="size-3.5" />
              </button>
              <button
                type="button"
                className={ICON_BUTTON}
                aria-label={t('chrome.miniPlayer.skipBack', { seconds: state.skipBackSeconds })}
                title={t('chrome.miniPlayer.skipBack', { seconds: state.skipBackSeconds })}
                onClick={() => send({ type: 'skipBack' })}
              >
                <SkipBackIcon seconds={state.skipBackSeconds} className="size-6" />
              </button>
              <button
                type="button"
                className="focus-ring inline-flex size-10 cursor-pointer items-center justify-center rounded-full border-none bg-lib-accent text-lib-on-accent hover:bg-lib-accent-hover [-webkit-app-region:no-drag]"
                aria-label={state.playing ? t('chrome.miniPlayer.pause') : t('chrome.miniPlayer.play')}
                title={state.playing ? t('chrome.miniPlayer.pause') : t('chrome.miniPlayer.play')}
                onClick={() => send({ type: 'toggle' })}
              >
                {state.playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
              </button>
              <button
                type="button"
                className={ICON_BUTTON}
                aria-label={t('chrome.miniPlayer.skipForward', { seconds: state.skipForwardSeconds })}
                title={t('chrome.miniPlayer.skipForward', { seconds: state.skipForwardSeconds })}
                onClick={() => send({ type: 'skipForward' })}
              >
                <SkipForwardIcon seconds={state.skipForwardSeconds} className="size-6" />
              </button>
              <button
                type="button"
                className={ICON_BUTTON}
                disabled={!state.canNext}
                aria-label={t('audiobook.player.controls.nextChapter')}
                title={t('audiobook.player.controls.nextChapter')}
                onClick={() => send({ type: 'next' })}
              >
                <NextIcon className="size-3.5" />
              </button>
            </div>
            <span className="w-12 text-right text-[12px] tabular-nums text-lib-muted">
              {duration ? `-${formatPlaybackTime(Math.max(0, duration - shown))}` : ''}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
