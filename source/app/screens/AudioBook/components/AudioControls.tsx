import { useEffect, useState } from 'react'
import { PLAYBACK_RATES, formatPlaybackTime } from '@core'
import { useNoteMenuStore } from '../logic/audioNoteMenuStore'
import { AudioSelect, type AudioSelectOption } from './AudioSelect'
import { SLEEP_MINUTES, selectCanAddNote, useAudioPlayerStore, type SleepOption } from '../logic/audioPlayerStore'
import { useT } from '../../../i18n'
import { useShortcutLabel } from '../../../shortcuts'
import { useListeningPrefsStore } from '../logic/listeningPrefsStore'
import { ListeningMenu } from './ListeningMenu'
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon, SkipBackIcon, SkipForwardIcon, SpeakerIcon } from '../../../components/audio/AudioIcons'

const ROUND =
  'focus-ring inline-flex cursor-pointer items-center justify-center rounded-full border border-lib-border bg-lib-surface text-sm font-semibold text-lib-text hover:bg-lib-surface-hover disabled:cursor-not-allowed disabled:opacity-40'
const PILL =
  'inline-flex h-9 items-center gap-2 rounded-full border border-lib-border bg-lib-surface px-3 text-xs font-semibold text-lib-muted'

function optionValue(sleep: SleepOption): string {
  return sleep.kind === 'minutes' ? String(sleep.minutes) : sleep.kind
}

function SleepTimer() {
  const t = useT()
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
    { value: 'off', label: t('audiobook.player.controls.sleepOff') },
    ...SLEEP_MINUTES.map((m) => ({ value: String(m), label: t('audiobook.player.controls.sleepMinutes', { minutes: m }) })),
    multiTrack
      ? { value: 'chapter', label: t('audiobook.player.controls.endOfTrack') }
      : { value: 'chapter', label: t('audiobook.player.controls.endOfChapter'), disabled: !hasChapters, hint: t('audiobook.player.controls.needsChapters') },
  ]
  return (
    <AudioSelect
      label={t('audiobook.player.controls.sleep')}
      ariaLabel={t('audiobook.player.controls.sleepTimer')}
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
  const t = useT()
  const playing = useAudioPlayerStore((s) => s.playing)
  const rate = useAudioPlayerStore((s) => s.playbackRate)
  const volume = useAudioPlayerStore((s) => s.volume)
  const muted = useAudioPlayerStore((s) => s.muted)
  const toggleMute = useAudioPlayerStore((s) => s.toggleMute)
  // Spec 018 FR-014 / FR-028: the listener's skip lengths, on the buttons and in their names.
  const skipBack = useListeningPrefsStore((s) => s.skipBackSeconds)
  const skipForward = useListeningPrefsStore((s) => s.skipForwardSeconds)
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
  const noChapters = hasChapters || multiTrack ? undefined : t('audiobook.player.controls.noChapters')
  // Spec 018 FR-007: tooltips name the shortcut's CURRENT key (Settings → Keyboard Shortcuts can change it).
  const keys = {
    playPause: useShortcutLabel('audiobook.playPause'),
    skipBack: useShortcutLabel('audiobook.skipBack'),
    skipForward: useShortcutLabel('audiobook.skipForward'),
    previous: useShortcutLabel('audiobook.previousChapter'),
    next: useShortcutLabel('audiobook.nextChapter'),
    addNote: useShortcutLabel('audiobook.addNote'),
    mute: useShortcutLabel('audiobook.mute'),
  }
  const withKey = (text: string, shortcut: string) => t('audiobook.player.controls.withShortcut', { text, shortcut })
  const previousLabel = multiTrack ? t('audiobook.player.controls.previousTrack') : t('audiobook.player.controls.previousChapter')
  const nextLabel = multiTrack ? t('audiobook.player.controls.nextTrack') : t('audiobook.player.controls.nextChapter')

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center justify-center gap-3">
        <button type="button" className={`${ROUND} size-11 border-transparent bg-transparent`} aria-label={previousLabel} title={noChapters ?? withKey(previousLabel, keys.previous)} disabled={!hasChapters && !multiTrack} onClick={previousChapter}>
          <PreviousIcon />
        </button>
        <button type="button" className={`${ROUND} size-14`} aria-label={t('audiobook.player.controls.skipBack', { seconds: skipBack })} title={withKey(t('audiobook.player.controls.skipBack', { seconds: skipBack }), keys.skipBack)} onClick={() => skipBy(-skipBack)}>
          <SkipBackIcon seconds={skipBack} />
        </button>
        <button
          type="button"
          className="focus-ring inline-flex size-[72px] cursor-pointer items-center justify-center rounded-full bg-lib-accent text-lib-on-accent shadow-lg hover:bg-lib-accent-hover active:scale-95 motion-reduce:active:scale-100"
          aria-label={playing ? t('audiobook.player.controls.pause') : t('audiobook.player.controls.play')}
          title={withKey(playing ? t('audiobook.player.controls.pause') : t('audiobook.player.controls.play'), keys.playPause)}
          onClick={toggle}
        >
          {playing ? <PauseIcon className="size-6" /> : <PlayIcon className="size-6" />}
        </button>
        <button type="button" className={`${ROUND} size-14`} aria-label={t('audiobook.player.controls.skipForward', { seconds: skipForward })} title={withKey(t('audiobook.player.controls.skipForward', { seconds: skipForward }), keys.skipForward)} onClick={() => skipBy(skipForward)}>
          <SkipForwardIcon seconds={skipForward} />
        </button>
        <button type="button" className={`${ROUND} size-11 border-transparent bg-transparent`} aria-label={nextLabel} title={noChapters ?? withKey(nextLabel, keys.next)} disabled={(!hasChapters && !multiTrack) || onLastTrack} onClick={nextChapter}>
          <NextIcon />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <AudioSelect
          label={t('audiobook.player.controls.speed')}
          ariaLabel={t('audiobook.player.controls.playbackSpeed')}
          value={String(rate)}
          valueLabel={`${rate}×`}
          options={(PLAYBACK_RATES.includes(rate) ? PLAYBACK_RATES : [...PLAYBACK_RATES, rate]).map((r) => ({ value: String(r), label: `${r}×` }))}
          onChange={(v) => setRate(Number(v))}
        />
        <SleepTimer />
        <button
          type="button"
          className={`${PILL} focus-ring cursor-pointer hover:bg-lib-surface-hover disabled:cursor-not-allowed disabled:opacity-40`}
          data-audio-add-note
          title={canAddNote ? withKey(t('audiobook.player.controls.markNote'), keys.addNote) : t('audiobook.player.controls.noteNotReady')}
          disabled={!canAddNote}
          onClick={(e) => {
            const id = addNote()
            if (id) openNoteMenu(id, e.currentTarget, 'edit')
          }}
        >
          {t('audiobook.player.controls.addNote')}
        </button>
        <span className={PILL}>
          <button
            type="button"
            className="focus-ring -ml-1.5 inline-flex size-7 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-lib-text hover:bg-lib-surface-hover hover:text-lib-text-strong"
            aria-label={muted ? t('audiobook.player.controls.unmute') : t('audiobook.player.controls.mute')}
            aria-pressed={muted}
            title={withKey(muted ? t('audiobook.player.controls.unmute') : t('audiobook.player.controls.mute'), keys.mute)}
            onClick={toggleMute}
          >
            <SpeakerIcon muted={muted} />
          </button>
          <input
            type="range"
            aria-label={t('audiobook.player.controls.volume')}
            className="focus-ring w-24 cursor-pointer rounded accent-[var(--lib-accent,currentColor)]"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </span>
        <ListeningMenu />
      </div>
    </div>
  )
}
