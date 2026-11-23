import { chapterIndexAt } from '@core'
import { isFeatureAvailable } from '../../../platforms/host'
import { selectCanChangeChapter, useAudioPlayerStore, type AudioPlayerState } from './audioPlayerStore'
import { currentSkipLengths } from './skipLengths'

/**
 * Spec 018 US3 (FR-008 – FR-011, research R7): the listening session in the operating system's media controls (Windows
 * media flyout / lock screen, media keys) through `navigator.mediaSession`. Metadata follows the chapter / track; the
 * handlers run the same store actions as the player's buttons and are `null` exactly when those buttons are disabled.
 * Cleared when the session ends — leaving the player screen alone does not end it.
 */

const ARTWORK_SIZE = 256

type Session = MediaSession

function mediaSession(): Session | null {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null
}

/** A cover drawn once per book into a 256 px square, as a `data:` URL (the system fetches artwork outside the page). */
const artworkByCover = new Map<string, Promise<string | null>>()

function artworkFor(coverUrl: string): Promise<string | null> {
  const cached = artworkByCover.get(coverUrl)
  if (cached) return cached
  const made = new Promise<string | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = ARTWORK_SIZE
        canvas.height = ARTWORK_SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        const scale = Math.min(ARTWORK_SIZE / img.naturalWidth, ARTWORK_SIZE / img.naturalHeight)
        const w = img.naturalWidth * scale
        const h = img.naturalHeight * scale
        ctx.drawImage(img, (ARTWORK_SIZE - w) / 2, (ARTWORK_SIZE - h) / 2, w, h)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(null) // a tainted canvas: no artwork rather than an error
      }
    }
    img.onerror = () => resolve(null)
    img.src = coverUrl
  })
  artworkByCover.set(coverUrl, made)
  return made
}

type MetadataKey = { bookId: string; title: string; subtitle: string | null; author: string; artwork: string | null }

function metadataKeyOf(s: AudioPlayerState, artwork: string | null): MetadataKey | null {
  if (!s.bookId || s.status !== 'ready') return null
  const track = s.tracks[s.trackIndex]
  const chapter = s.chapterStatus === 'ok' ? s.chapters[chapterIndexAt(s.chapters, s.positionSeconds)] : undefined
  return {
    bookId: s.bookId,
    title: s.title,
    subtitle: track?.title ?? chapter?.title ?? null,
    author: s.author ?? '',
    artwork,
  }
}

function setHandler(session: Session, action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
  try {
    session.setActionHandler(action, handler)
  } catch {
    // An action this Chromium does not know: ignore.
  }
}

let started = false

export function startMediaSessionBridge(): () => void {
  const session = mediaSession()
  if (started || !session || !isFeatureAvailable('miniPlayer')) return () => {}
  started = true

  let lastKey = ''
  let lastHandlersKey = ''
  let lastPositionKey = ''
  let artwork: string | null = null
  let artworkFor_: string | null = null

  const store = useAudioPlayerStore.getState

  const clear = () => {
    session.metadata = null
    session.playbackState = 'none'
    for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto'] as const) {
      setHandler(session, action, null)
    }
    lastKey = ''
    lastHandlersKey = ''
    lastPositionKey = ''
  }

  const sync = () => {
    const s = store()
    if (!s.bookId || s.status !== 'ready') {
      if (lastKey !== '') clear()
      artwork = null
      artworkFor_ = null
      return
    }
    // Artwork: drawn once per cover, then the metadata is published again with it.
    if (s.coverUrl && artworkFor_ !== s.coverUrl) {
      artworkFor_ = s.coverUrl
      artwork = null
      const forCover = s.coverUrl
      void artworkFor(forCover).then((url) => {
        if (artworkFor_ !== forCover) return
        artwork = url
        sync()
      })
    } else if (!s.coverUrl) {
      artworkFor_ = null
      artwork = null
    }

    const meta = metadataKeyOf(s, artwork)
    const key = JSON.stringify(meta)
    if (meta && key !== lastKey) {
      lastKey = key
      session.metadata = new MediaMetadata({
        title: meta.subtitle ?? meta.title,
        artist: meta.author,
        album: meta.title,
        artwork: meta.artwork ? [{ src: meta.artwork, sizes: `${ARTWORK_SIZE}x${ARTWORK_SIZE}`, type: 'image/png' }] : [],
      })
    }
    session.playbackState = s.playing ? 'playing' : 'paused'

    const canPrevious = selectCanChangeChapter(s, -1)
    const canNext = selectCanChangeChapter(s, 1)
    const handlersKey = `${canPrevious}|${canNext}`
    if (handlersKey !== lastHandlersKey) {
      lastHandlersKey = handlersKey
      setHandler(session, 'play', () => store().play())
      setHandler(session, 'pause', () => store().pause())
      setHandler(session, 'previoustrack', canPrevious ? () => store().previousChapter() : null)
      setHandler(session, 'nexttrack', canNext ? () => store().nextChapter() : null)
      setHandler(session, 'seekbackward', (d) => store().skipBy(-(d.seekOffset ?? currentSkipLengths().back)))
      setHandler(session, 'seekforward', (d) => store().skipBy(d.seekOffset ?? currentSkipLengths().forward))
      setHandler(session, 'seekto', (d) => {
        if (typeof d.seekTime === 'number') store().seekTo(d.seekTime)
      })
    }

    // Position state on load / seek / rate / chapter change — not on every tick (the system extrapolates).
    const duration = s.durationSeconds
    if (duration && Number.isFinite(duration) && duration > 0) {
      const position = Math.min(Math.max(0, s.positionSeconds), duration)
      const positionKey = `${s.bookId}|${s.trackIndex}|${duration}|${s.playbackRate}|${s.playing}|${Math.round(position / 5)}`
      if (positionKey !== lastPositionKey) {
        lastPositionKey = positionKey
        try {
          session.setPositionState({ duration, playbackRate: s.playbackRate, position })
        } catch {
          // Out-of-range values while a track switches: the next update fixes it.
        }
      }
    }
  }

  const stop = useAudioPlayerStore.subscribe(sync)
  sync()
  return () => {
    started = false
    stop()
    clear()
  }
}
