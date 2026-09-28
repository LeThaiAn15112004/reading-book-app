import type { MutableRefObject } from 'react'
import { create } from 'zustand'
import type { EpubRendererApi, ReadAloudSection } from '../../../../reader/renderers/epub'
import { createWebSpeechEngine } from '../../../../reader/tts/webSpeechEngine'

export type ReadAloudStatus = 'idle' | 'loading' | 'playing' | 'paused'
export const READ_ALOUD_RATES = [0.75, 1, 1.25, 1.5, 2] as const

const PREFS_STORAGE_KEY = 'reading-book.readAloud.prefs'
const DEFAULT_RATE = 1
const DEFAULT_VOLUME = 1
/** Sections with no speakable text (image-only pages, separators) skipped before giving up. */
const MAX_EMPTY_SECTIONS = 5
/** Slider drags fire many changes; restart the sentence once the value settles. */
const RESPEAK_DEBOUNCE_MS = 250

type Prefs = { rate: number; volume: number }

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function readStoredPrefs(): Prefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? 'null') as Partial<Prefs> | null
    return {
      rate: typeof parsed?.rate === 'number' ? clamp(parsed.rate, 0.5, 2) : DEFAULT_RATE,
      volume: typeof parsed?.volume === 'number' ? clamp(parsed.volume, 0, 1) : DEFAULT_VOLUME,
    }
  } catch {
    return { rate: DEFAULT_RATE, volume: DEFAULT_VOLUME }
  }
}

function writeStoredPrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* ignore quota / private mode */
  }
}

function waitForFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) resolve()
      else requestAnimationFrame(() => step(left - 1))
    }
    step(count)
  })
}

type Queue = {
  spineIndex: number
  lang: string
  segments: string[]
  index: number
  /** Exclusive end of the span to read in this section. */
  endIndex: number
  /** The current segment's utterance has started (so pause/resume applies to it). */
  spoken: boolean
}

/** Values `useReadAloud` syncs in from ReaderScreen — read via `get()`, never rendered. */
type ReadAloudContext = {
  isEpubSurface: boolean
  epubApiRef: MutableRefObject<EpubRendererApi | null> | null
  setToast: (message: string | null) => void
}

type ReadAloudState = ReadAloudContext & {
  menuOpen: boolean
  status: ReadAloudStatus
  /** `viewport` stops at the end of what was visible; `continuous` runs on through the book. */
  mode: 'viewport' | 'continuous'
  rate: number
  volume: number
  queue: Queue | null

  setContext: (context: ReadAloudContext) => void
  openMenu: () => void
  closeMenu: () => void
  readViewport: () => void
  readFromPosition: () => void
  togglePlayPause: () => void
  stop: () => void
  setRate: (rate: number) => void
  setVolume: (volume: number) => void
}

const engine = createWebSpeechEngine()
export const readAloudSupported = engine.isSupported()

/** Bumped on every start/stop; callbacks from an older session are dropped. */
let session = 0
let respeakTimer: number | undefined
const warnedLangs = new Set<string>()

/**
 * Read aloud (toolbar "Audio"): one utterance per sentence-sized segment of the displayed EPUB
 * section, highlighted and followed through the `EpubRendererApi`. One Reader route is mounted at
 * a time, so one shared store is safe, same as `useBookSearchStore`.
 */
export const useReadAloudStore = create<ReadAloudState>()((set, get) => {
  const toast = (message: string) => get().setToast(message)
  const api = () => get().epubApiRef?.current ?? null

  const finish = () => {
    session++
    window.clearTimeout(respeakTimer)
    engine.cancel()
    set({ status: 'idle', queue: null })
    void api()?.setReadAloudCursor(null)
  }

  const prepareVoice = async (lang: string) => {
    const match = await engine.resolveVoice(lang)
    if (!match.exact && !warnedLangs.has(lang)) {
      warnedLangs.add(lang)
      toast(`No ${lang} voice installed — using the default voice.`)
    }
  }

  const loadSection = async (token: number, section: ReadAloudSection, startIndex: number) => {
    await prepareVoice(section.lang)
    if (token !== session) return
    set({
      queue: {
        spineIndex: section.spineIndex,
        lang: section.lang,
        segments: section.segments,
        index: startIndex,
        endIndex: section.endIndex,
        spoken: false,
      },
    })
    if (get().status === 'loading') set({ status: 'playing' })
    await speakCurrent(token)
  }

  const advanceSection = async (token: number, fromSpine: number) => {
    const renderer = api()
    if (!renderer) return finish()
    let spine = fromSpine
    for (let attempt = 0; attempt < MAX_EMPTY_SECTIONS; attempt++) {
      await renderer.nextSection()
      await waitForFrames(2)
      if (token !== session) return
      const section = renderer.getReadAloudSegments('section')
      if (!section || section.spineIndex === spine) {
        finish()
        toast('Reached the end of the book.')
        return
      }
      if (section.startIndex < section.endIndex) {
        await loadSection(token, section, section.startIndex)
        return
      }
      spine = section.spineIndex
    }
    finish()
  }

  const speakCurrent = async (token: number): Promise<void> => {
    const { queue } = get()
    const renderer = api()
    if (!queue || !renderer) return finish()
    if (queue.index >= queue.endIndex) {
      if (get().mode === 'viewport') return finish()
      return advanceSection(token, queue.spineIndex)
    }

    await renderer.setReadAloudCursor({ spineIndex: queue.spineIndex, index: queue.index })
    // Paused (or stopped) while the page was turning: resume will speak it.
    if (token !== session || get().status !== 'playing') return

    const { rate, volume } = get()
    set({ queue: { ...queue, spoken: true } })
    engine.speak(
      { text: queue.segments[queue.index] ?? '', lang: queue.lang, rate, volume },
      {
        onEnd: () => {
          if (token !== session) return
          const current = get().queue
          if (!current) return
          set({ queue: { ...current, index: current.index + 1, spoken: false } })
          void speakCurrent(token)
        },
        onError: (error) => {
          if (token !== session) return
          finish()
          toast(`Read aloud stopped (${error}).`)
        },
      },
    )
  }

  const start = async (kind: 'viewport' | 'fromPosition') => {
    const renderer = api()
    set({ menuOpen: false })
    if (!renderer || !get().isEpubSurface) {
      toast('Read aloud is available for EPUB books.')
      return
    }
    if (!readAloudSupported) {
      toast('Speech synthesis is not available on this system.')
      return
    }
    finish()
    const token = session
    set({ status: 'loading', mode: kind === 'viewport' ? 'viewport' : 'continuous' })
    const section = renderer.getReadAloudSegments(kind)
    if (!section) {
      finish()
      toast('Nothing to read here.')
      return
    }
    if (section.startIndex >= section.endIndex) {
      if (kind === 'viewport') {
        finish()
        toast('Nothing to read on this page.')
        return
      }
      set({ status: 'playing' })
      await advanceSection(token, section.spineIndex)
      return
    }
    await loadSection(token, section, section.startIndex)
  }

  /** Apply a new rate/volume to the sentence being read. */
  const scheduleRespeak = () => {
    window.clearTimeout(respeakTimer)
    respeakTimer = window.setTimeout(() => {
      const { status, queue } = get()
      if (!queue?.spoken) return
      if (status === 'playing') {
        engine.cancel()
        set({ queue: { ...queue, spoken: false } })
        void speakCurrent(session)
      } else if (status === 'paused') {
        // Resume re-speaks with the new settings instead of continuing the old utterance.
        engine.cancel()
        set({ queue: { ...queue, spoken: false } })
      }
    }, RESPEAK_DEBOUNCE_MS)
  }

  const prefs = readStoredPrefs()

  return {
    isEpubSurface: false,
    epubApiRef: null,
    setToast: () => {},
    menuOpen: false,
    status: 'idle',
    mode: 'continuous',
    rate: prefs.rate,
    volume: prefs.volume,
    queue: null,

    setContext: (context) => set(context),
    openMenu: () => set({ menuOpen: true }),
    closeMenu: () => set({ menuOpen: false }),
    readViewport: () => void start('viewport'),
    readFromPosition: () => void start('fromPosition'),

    togglePlayPause: () => {
      const { status, queue } = get()
      if (status === 'playing') {
        engine.pause()
        set({ status: 'paused' })
      } else if (status === 'paused') {
        set({ status: 'playing' })
        if (queue?.spoken) engine.resume()
        else void speakCurrent(session)
      } else if (status === 'idle') {
        void start('fromPosition')
      }
    },

    stop: () => {
      if (get().status !== 'idle') finish()
    },

    setRate: (rate) => {
      set({ rate })
      writeStoredPrefs({ rate, volume: get().volume })
      scheduleRespeak()
    },

    setVolume: (volume) => {
      set({ volume })
      writeStoredPrefs({ rate: get().rate, volume })
      scheduleRespeak()
    },
  }
})
