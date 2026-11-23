import { chapterIndexAt } from '@core'
import { miniPlayerApi, type MiniPlayerCommand, type MiniPlayerState } from '../../../bridge'
import { getUiLanguage, useUiLanguageStore } from '../../../i18n'
import { isFeatureAvailable } from '../../../platforms/host'
import { endAudioSession, selectCanChangeChapter, useAudioPlayerStore, type AudioPlayerState } from './audioPlayerStore'
import { useMiniPlayerUiStore } from './miniPlayerUiStore'
import { currentSkipLengths } from './skipLengths'

/**
 * Spec 018 (FR-021, FR-022, contracts/mini-player-ipc.md): keeps Main — and through it the floating window and the
 * tray — in step with the ONE listening session in the main window, and runs their commands on the same store. Started
 * once by `App` on Desktop; never in the floating window (it has its own root and no `window.api`).
 */

/** Position updates while playing: at most this often (non-position changes go at once). */
const POSITION_INTERVAL_MS = 250

type Theme = MiniPlayerState extends infer S ? (S extends { theme: infer T } ? T : never) : never

function currentTheme(): Theme {
  const raw = typeof document === 'undefined' ? '' : (document.documentElement.dataset.theme ?? '')
  if (raw === 'sepia') return 'sepia'
  if (raw === 'paper' || raw === 'day') return 'paper'
  return 'night'
}

/** The snapshot Main relays, or `null` without a session. Pure apart from reading the theme / language. */
export function toMiniPlayerState(s: AudioPlayerState): MiniPlayerState {
  if (!s.bookId || s.status !== 'ready') return null
  const track = s.tracks[s.trackIndex]
  const chapterIndex = s.chapterStatus === 'ok' ? chapterIndexAt(s.chapters, s.positionSeconds) : -1
  const subtitle = track ? track.title : chapterIndex >= 0 ? (s.chapters[chapterIndex]?.title ?? null) : null
  const failed = track !== undefined && s.trackErrors.has(track.id)
  const skip = currentSkipLengths()
  return {
    bookId: s.bookId,
    title: s.title.slice(0, 500),
    subtitle: subtitle ? subtitle.slice(0, 500) : null,
    author: s.author ? s.author.slice(0, 500) : null,
    coverUrl: s.coverUrl?.startsWith('rb-cover://') ? s.coverUrl : null,
    playing: s.playing,
    status: failed ? 'trackFailed' : s.switching ? 'switching' : 'ready',
    positionSeconds: Math.max(0, Number.isFinite(s.positionSeconds) ? s.positionSeconds : 0),
    durationSeconds: s.durationSeconds !== null && Number.isFinite(s.durationSeconds) ? s.durationSeconds : null,
    skipBackSeconds: skip.back,
    skipForwardSeconds: skip.forward,
    canPrevious: selectCanChangeChapter(s, -1),
    canNext: selectCanChangeChapter(s, 1),
    theme: currentTheme(),
    uiLanguage: getUiLanguage() === 'vi' ? 'vi' : 'en',
  }
}

/** Run a command from the floating window / tray on the session (same actions as the player's own buttons). */
export function runMiniPlayerCommand(command: MiniPlayerCommand): void {
  const s = useAudioPlayerStore.getState()
  const skip = currentSkipLengths()
  switch (command.type) {
    case 'toggle':
      return s.toggle()
    case 'play':
      return s.play()
    case 'pause':
      return s.pause()
    case 'skipBack':
      return s.skipBy(-skip.back)
    case 'skipForward':
      return s.skipBy(skip.forward)
    case 'previous':
      if (selectCanChangeChapter(s, -1)) s.previousChapter()
      return
    case 'next':
      if (selectCanChangeChapter(s, 1)) s.nextChapter()
      return
    case 'seek':
      return s.seekTo(command.positionSeconds)
    case 'retryTrack':
      return s.goToTrack(s.trackIndex)
    case 'openPlayer':
      if (s.bookId) window.location.hash = `#/reader/${encodeURIComponent(s.bookId)}`
      return
    case 'endSession':
      void endAudioSession()
      return
  }
}

/** Equal apart from the position (so position ticks can be throttled). */
function sameButPosition(a: MiniPlayerState, b: MiniPlayerState): boolean {
  if (a === null || b === null) return a === b
  return JSON.stringify({ ...a, positionSeconds: 0 }) === JSON.stringify({ ...b, positionSeconds: 0 })
}

let started = false

export function startMiniPlayerSync(): () => void {
  if (started || !isFeatureAvailable('miniPlayer')) return () => {}
  started = true
  let last: MiniPlayerState = null
  let lastSentAt = 0
  let pending: ReturnType<typeof setTimeout> | null = null

  const send = (state: MiniPlayerState) => {
    last = state
    lastSentAt = Date.now()
    miniPlayerApi.publishState(state)
  }
  const publish = () => {
    const next = toMiniPlayerState(useAudioPlayerStore.getState())
    if (JSON.stringify(next) === JSON.stringify(last)) return
    if (!sameButPosition(next, last)) {
      if (pending) clearTimeout(pending)
      pending = null
      send(next)
      return
    }
    const wait = POSITION_INTERVAL_MS - (Date.now() - lastSentAt)
    if (wait <= 0) send(next)
    else if (!pending) {
      pending = setTimeout(() => {
        pending = null
        send(toMiniPlayerState(useAudioPlayerStore.getState()))
      }, wait)
    }
  }

  const stopStore = useAudioPlayerStore.subscribe(publish)
  const stopLanguage = useUiLanguageStore.subscribe(publish)
  const themeObserver = new MutationObserver(publish)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'lang'] })
  const stopCommands = miniPlayerApi.onCommand(runMiniPlayerCommand)
  const stopWindow = miniPlayerApi.onWindowChanged(({ open }) => useMiniPlayerUiStore.getState().setWindowOpen(open))
  publish()

  return () => {
    started = false
    stopStore()
    stopLanguage()
    themeObserver.disconnect()
    stopCommands()
    stopWindow()
    if (pending) clearTimeout(pending)
  }
}
